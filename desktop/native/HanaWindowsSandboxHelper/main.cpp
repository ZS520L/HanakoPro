#ifndef UNICODE
#define UNICODE
#endif
#ifndef _UNICODE
#define _UNICODE
#endif

#include <windows.h>
#include <userenv.h>
#include <aclapi.h>
#include <sddl.h>

#include <iostream>
#include <stdexcept>
#include <string>
#include <vector>

struct Grant {
    std::wstring path;
    ACCESS_MODE mode;
    DWORD permissions;
    bool required;
};

struct Options {
    std::wstring cwd;
    bool internetClient = false;
    bool internetClientServer = false;
    bool privateNetworkClientServer = false;
    std::vector<Grant> grants;
    std::wstring executable;
    std::vector<std::wstring> args;
};

struct AclRestore {
    std::wstring path;
    PSECURITY_DESCRIPTOR descriptor = nullptr;
    PACL oldDacl = nullptr;
};

static void fail(const std::wstring& message) {
    std::wcerr << L"hana-win-sandbox: " << message << std::endl;
}

static void debug(const std::wstring& message) {
    wchar_t enabled[8] = {};
    DWORD n = GetEnvironmentVariableW(L"HANA_WIN32_SANDBOX_DEBUG", enabled, 8);
    if (n > 0 && enabled[0] != L'\0' && enabled[0] != L'0') {
        std::wcerr << L"hana-win-sandbox: " << message << std::endl;
    }
}

static std::wstring win32Message(DWORD code) {
    LPWSTR buffer = nullptr;
    FormatMessageW(
        FORMAT_MESSAGE_ALLOCATE_BUFFER | FORMAT_MESSAGE_FROM_SYSTEM | FORMAT_MESSAGE_IGNORE_INSERTS,
        nullptr,
        code,
        0,
        reinterpret_cast<LPWSTR>(&buffer),
        0,
        nullptr
    );
    std::wstring out = buffer ? buffer : L"unknown error";
    if (buffer) LocalFree(buffer);
    return out;
}

static bool isDirectory(const std::wstring& p) {
    DWORD attrs = GetFileAttributesW(p.c_str());
    return attrs != INVALID_FILE_ATTRIBUTES && (attrs & FILE_ATTRIBUTE_DIRECTORY);
}

static Options parseArgs(int argc, wchar_t** argv) {
    Options opts;
    bool passthrough = false;
    for (int i = 1; i < argc; i++) {
        std::wstring arg = argv[i];
        if (passthrough) {
            if (opts.executable.empty()) opts.executable = arg;
            else opts.args.push_back(arg);
            continue;
        }
        if (arg == L"--") {
            passthrough = true;
            continue;
        }
        if (arg == L"--cwd" && i + 1 < argc) {
            opts.cwd = argv[++i];
            continue;
        }
        if (arg == L"--network" && i + 1 < argc) {
            std::wstring value = argv[++i];
            if (value == L"internet-client") {
                opts.internetClient = true;
                continue;
            }
            if (value == L"internet-client-server") {
                opts.internetClientServer = true;
                continue;
            }
            if (value == L"private-network-client-server") {
                opts.privateNetworkClientServer = true;
                continue;
            }
            throw std::runtime_error("unknown network capability");
        }
        if ((arg == L"--grant-read" || arg == L"--grant-read-optional" ||
             arg == L"--grant-write" || arg == L"--grant-write-optional" ||
             arg == L"--deny-write") && i + 1 < argc) {
            std::wstring target = argv[++i];
            if (arg == L"--grant-read" || arg == L"--grant-read-optional") {
                opts.grants.push_back({
                    target,
                    GRANT_ACCESS,
                    FILE_GENERIC_READ | FILE_GENERIC_EXECUTE,
                    arg == L"--grant-read"
                });
            } else if (arg == L"--grant-write" || arg == L"--grant-write-optional") {
                opts.grants.push_back({
                    target,
                    GRANT_ACCESS,
                    FILE_GENERIC_READ | FILE_GENERIC_WRITE | FILE_GENERIC_EXECUTE | DELETE | FILE_DELETE_CHILD,
                    arg == L"--grant-write"
                });
            } else {
                opts.grants.push_back({
                    target,
                    DENY_ACCESS,
                    FILE_WRITE_DATA | FILE_APPEND_DATA | FILE_WRITE_EA | FILE_WRITE_ATTRIBUTES | DELETE | FILE_DELETE_CHILD,
                    true
                });
            }
            continue;
        }
        throw std::runtime_error("unknown or incomplete argument");
    }
    if (opts.cwd.empty()) throw std::runtime_error("missing --cwd");
    if (opts.executable.empty()) throw std::runtime_error("missing executable after --");
    return opts;
}

static std::wstring quoteArg(const std::wstring& arg) {
    if (arg.empty()) return L"\"\"";
    bool needsQuotes = arg.find_first_of(L" \t\n\v\"") != std::wstring::npos;
    if (!needsQuotes) return arg;

    std::wstring out = L"\"";
    size_t backslashes = 0;
    for (wchar_t ch : arg) {
        if (ch == L'\\') {
            backslashes++;
            continue;
        }
        if (ch == L'"') {
            out.append(backslashes * 2 + 1, L'\\');
            out.push_back(ch);
            backslashes = 0;
            continue;
        }
        out.append(backslashes, L'\\');
        backslashes = 0;
        out.push_back(ch);
    }
    out.append(backslashes * 2, L'\\');
    out.push_back(L'"');
    return out;
}

static std::wstring buildCommandLine(const Options& opts) {
    std::wstring command = quoteArg(opts.executable);
    for (const auto& arg : opts.args) {
        command.push_back(L' ');
        command += quoteArg(arg);
    }
    return command;
}

static bool applyGrant(const Grant& grant, PSID sid, std::vector<AclRestore>& restores) {
    PACL oldDacl = nullptr;
    PSECURITY_DESCRIPTOR descriptor = nullptr;
    DWORD rc = GetNamedSecurityInfoW(
        const_cast<LPWSTR>(grant.path.c_str()),
        SE_FILE_OBJECT,
        DACL_SECURITY_INFORMATION,
        nullptr,
        nullptr,
        &oldDacl,
        nullptr,
        &descriptor
    );
    if (rc != ERROR_SUCCESS) {
        if (grant.required) {
            fail(L"cannot read ACL for " + grant.path + L": " + win32Message(rc));
        } else {
            debug(L"skipping optional ACL grant for " + grant.path + L": " + win32Message(rc));
        }
        return false;
    }

    EXPLICIT_ACCESSW access = {};
    access.grfAccessPermissions = grant.permissions;
    access.grfAccessMode = grant.mode;
    access.grfInheritance = isDirectory(grant.path) ? (OBJECT_INHERIT_ACE | CONTAINER_INHERIT_ACE) : NO_INHERITANCE;
    access.Trustee.TrusteeForm = TRUSTEE_IS_SID;
    access.Trustee.TrusteeType = TRUSTEE_IS_UNKNOWN;
    access.Trustee.ptstrName = reinterpret_cast<LPWSTR>(sid);

    PACL newDacl = nullptr;
    rc = SetEntriesInAclW(1, &access, oldDacl, &newDacl);
    if (rc != ERROR_SUCCESS) {
        if (grant.required) {
            fail(L"cannot build ACL for " + grant.path + L": " + win32Message(rc));
        } else {
            debug(L"skipping optional ACL grant for " + grant.path + L": " + win32Message(rc));
        }
        if (descriptor) LocalFree(descriptor);
        return false;
    }

    rc = SetNamedSecurityInfoW(
        const_cast<LPWSTR>(grant.path.c_str()),
        SE_FILE_OBJECT,
        DACL_SECURITY_INFORMATION,
        nullptr,
        nullptr,
        newDacl,
        nullptr
    );
    if (newDacl) LocalFree(newDacl);
    if (rc != ERROR_SUCCESS) {
        if (grant.required) {
            fail(L"cannot apply ACL for " + grant.path + L": " + win32Message(rc));
        } else {
            debug(L"skipping optional ACL grant for " + grant.path + L": " + win32Message(rc));
        }
        if (descriptor) LocalFree(descriptor);
        return false;
    }

    restores.push_back({ grant.path, descriptor, oldDacl });
    return true;
}

static void restoreAcls(std::vector<AclRestore>& restores) {
    for (auto it = restores.rbegin(); it != restores.rend(); ++it) {
        DWORD rc = SetNamedSecurityInfoW(
            const_cast<LPWSTR>(it->path.c_str()),
            SE_FILE_OBJECT,
            DACL_SECURITY_INFORMATION,
            nullptr,
            nullptr,
            it->oldDacl,
            nullptr
        );
        if (rc != ERROR_SUCCESS) {
            fail(L"cannot restore ACL for " + it->path + L": " + win32Message(rc));
        }
        if (it->descriptor) LocalFree(it->descriptor);
        it->descriptor = nullptr;
        it->oldDacl = nullptr;
    }
}

static bool createProfile(const std::wstring& moniker, PSID* appSid) {
    HRESULT hr = CreateAppContainerProfile(
        moniker.c_str(),
        L"Hana Command Sandbox",
        L"Per-run Hana command sandbox",
        nullptr,
        0,
        appSid
    );
    if (SUCCEEDED(hr)) return true;
    if (HRESULT_CODE(hr) == ERROR_ALREADY_EXISTS) {
        hr = DeriveAppContainerSidFromAppContainerName(moniker.c_str(), appSid);
        return SUCCEEDED(hr);
    }
    fail(L"cannot create AppContainer profile: HRESULT " + std::to_wstring(static_cast<unsigned long>(hr)));
    return false;
}

static bool addCapabilitySid(
    const wchar_t* sidString,
    std::vector<PSID>& ownedSids,
    std::vector<SID_AND_ATTRIBUTES>& capabilities
) {
    PSID sid = nullptr;
    if (!ConvertStringSidToSidW(sidString, &sid)) {
        fail(L"cannot create capability SID: " + win32Message(GetLastError()));
        return false;
    }
    ownedSids.push_back(sid);
    SID_AND_ATTRIBUTES attr = {};
    attr.Sid = sid;
    attr.Attributes = SE_GROUP_ENABLED;
    capabilities.push_back(attr);
    return true;
}

static void freeOwnedSids(std::vector<PSID>& sids) {
    for (PSID sid : sids) {
        if (sid) LocalFree(sid);
    }
    sids.clear();
}

static HANDLE createKillOnCloseJob() {
    HANDLE job = CreateJobObjectW(nullptr, nullptr);
    if (!job) return nullptr;
    JOBOBJECT_EXTENDED_LIMIT_INFORMATION info = {};
    info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
    if (!SetInformationJobObject(job, JobObjectExtendedLimitInformation, &info, sizeof(info))) {
        CloseHandle(job);
        return nullptr;
    }
    return job;
}

static int runSandboxed(const Options& opts, PSID appSid) {
    std::vector<PSID> capabilitySids;
    std::vector<SID_AND_ATTRIBUTES> capabilityAttrs;
    if (opts.internetClient) {
        // Well-known AppContainer capability SID for internetClient.
        if (!addCapabilitySid(L"S-1-15-3-1", capabilitySids, capabilityAttrs)) {
            freeOwnedSids(capabilitySids);
            return 1;
        }
    }
    if (opts.internetClientServer) {
        // Well-known AppContainer capability SID for internetClientServer.
        if (!addCapabilitySid(L"S-1-15-3-2", capabilitySids, capabilityAttrs)) {
            freeOwnedSids(capabilitySids);
            return 1;
        }
    }
    if (opts.privateNetworkClientServer) {
        // Well-known AppContainer capability SID for privateNetworkClientServer.
        if (!addCapabilitySid(L"S-1-15-3-3", capabilitySids, capabilityAttrs)) {
            freeOwnedSids(capabilitySids);
            return 1;
        }
    }

    SECURITY_CAPABILITIES capabilities = {};
    capabilities.AppContainerSid = appSid;
    capabilities.Capabilities = capabilityAttrs.empty() ? nullptr : capabilityAttrs.data();
    capabilities.CapabilityCount = static_cast<DWORD>(capabilityAttrs.size());
    capabilities.Reserved = 0;

    SIZE_T attrSize = 0;
    InitializeProcThreadAttributeList(nullptr, 1, 0, &attrSize);
    std::vector<unsigned char> attrBuffer(attrSize);

    STARTUPINFOEXW startup = {};
    startup.StartupInfo.cb = sizeof(startup);
    startup.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
    startup.StartupInfo.hStdInput = GetStdHandle(STD_INPUT_HANDLE);
    startup.StartupInfo.hStdOutput = GetStdHandle(STD_OUTPUT_HANDLE);
    startup.StartupInfo.hStdError = GetStdHandle(STD_ERROR_HANDLE);
    startup.lpAttributeList = reinterpret_cast<LPPROC_THREAD_ATTRIBUTE_LIST>(attrBuffer.data());

    if (!InitializeProcThreadAttributeList(startup.lpAttributeList, 1, 0, &attrSize)) {
        fail(L"InitializeProcThreadAttributeList failed: " + win32Message(GetLastError()));
        freeOwnedSids(capabilitySids);
        return 1;
    }

    if (!UpdateProcThreadAttribute(
        startup.lpAttributeList,
        0,
        PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES,
        &capabilities,
        sizeof(capabilities),
        nullptr,
        nullptr
    )) {
        fail(L"UpdateProcThreadAttribute failed: " + win32Message(GetLastError()));
        DeleteProcThreadAttributeList(startup.lpAttributeList);
        freeOwnedSids(capabilitySids);
        return 1;
    }

    std::wstring commandLine = buildCommandLine(opts);
    PROCESS_INFORMATION process = {};
    DWORD flags = EXTENDED_STARTUPINFO_PRESENT | CREATE_SUSPENDED | CREATE_NO_WINDOW;
    BOOL ok = CreateProcessW(
        opts.executable.c_str(),
        commandLine.data(),
        nullptr,
        nullptr,
        TRUE,
        flags,
        nullptr,
        opts.cwd.c_str(),
        &startup.StartupInfo,
        &process
    );

    DeleteProcThreadAttributeList(startup.lpAttributeList);

    if (!ok) {
        fail(L"CreateProcessW failed: " + win32Message(GetLastError()));
        freeOwnedSids(capabilitySids);
        return 1;
    }

    HANDLE job = createKillOnCloseJob();
    if (!job) {
        fail(L"CreateJobObject failed: " + win32Message(GetLastError()));
        TerminateProcess(process.hProcess, 1);
        CloseHandle(process.hThread);
        CloseHandle(process.hProcess);
        freeOwnedSids(capabilitySids);
        return 1;
    }
    if (!AssignProcessToJobObject(job, process.hProcess)) {
        fail(L"AssignProcessToJobObject failed: " + win32Message(GetLastError()));
        TerminateProcess(process.hProcess, 1);
        CloseHandle(job);
        CloseHandle(process.hThread);
        CloseHandle(process.hProcess);
        freeOwnedSids(capabilitySids);
        return 1;
    }

    ResumeThread(process.hThread);
    WaitForSingleObject(process.hProcess, INFINITE);
    DWORD exitCode = 1;
    GetExitCodeProcess(process.hProcess, &exitCode);

    CloseHandle(process.hThread);
    CloseHandle(process.hProcess);
    CloseHandle(job);
    freeOwnedSids(capabilitySids);
    return static_cast<int>(exitCode);
}

int wmain(int argc, wchar_t** argv) {
    Options opts;
    try {
        opts = parseArgs(argc, argv);
    } catch (const std::exception& err) {
        std::cerr << "hana-win-sandbox: " << err.what() << std::endl;
        return 2;
    }

    std::wstring moniker = L"com.hanako.sandbox." +
        std::to_wstring(GetCurrentProcessId()) + L"." +
        std::to_wstring(GetTickCount64());

    PSID appSid = nullptr;
    std::vector<AclRestore> restores;
    int exitCode = 1;

    if (!createProfile(moniker, &appSid)) {
        return 1;
    }

    bool grantsOk = true;
    for (const auto& grant : opts.grants) {
        if (!applyGrant(grant, appSid, restores)) {
            if (grant.required) {
                grantsOk = false;
                break;
            }
        }
    }

    if (grantsOk) {
        exitCode = runSandboxed(opts, appSid);
    }

    restoreAcls(restores);
    if (appSid) FreeSid(appSid);
    DeleteAppContainerProfile(moniker.c_str());
    return grantsOk ? exitCode : 1;
}
