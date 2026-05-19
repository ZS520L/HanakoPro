export const WINDOWS_UIA_HELPER_SCRIPT = String.raw`
$ErrorActionPreference = "Stop"

function Write-Result($obj) {
  $obj | ConvertTo-Json -Depth 40 -Compress
}

function Bounds-Of($el) {
  $r = $el.Current.BoundingRectangle
  return @{
    x = [double]$r.Left
    y = [double]$r.Top
    width = [double]$r.Width
    height = [double]$r.Height
  }
}

function Pattern-Names($el) {
  $names = @()
  $defs = @(
    @{ name = "InvokePattern"; pattern = [System.Windows.Automation.InvokePattern]::Pattern },
    @{ name = "ValuePattern"; pattern = [System.Windows.Automation.ValuePattern]::Pattern },
    @{ name = "ScrollPattern"; pattern = [System.Windows.Automation.ScrollPattern]::Pattern },
    @{ name = "SelectionItemPattern"; pattern = [System.Windows.Automation.SelectionItemPattern]::Pattern },
    @{ name = "TogglePattern"; pattern = [System.Windows.Automation.TogglePattern]::Pattern },
    @{ name = "ExpandCollapsePattern"; pattern = [System.Windows.Automation.ExpandCollapsePattern]::Pattern }
  )
  foreach ($def in $defs) {
    $out = $null
    if ($el.TryGetCurrentPattern($def.pattern, [ref]$out)) { $names += $def.name }
  }
  return $names
}

function Capture-Element($el) {
  try {
    Add-Type -AssemblyName System.Drawing
    $r = $el.Current.BoundingRectangle
    if ($r.Width -lt 1 -or $r.Height -lt 1) { return $null }
    $sourceW = [int]([Math]::Max(1, [Math]::Round($r.Width)))
    $sourceH = [int]([Math]::Max(1, [Math]::Round($r.Height)))
    $scale = [Math]::Min(1.0, [Math]::Min(1568.0 / [double]$sourceW, 1568.0 / [double]$sourceH))
    $w = [int]([Math]::Max(1, [Math]::Round($sourceW * $scale)))
    $h = [int]([Math]::Max(1, [Math]::Round($sourceH * $scale)))
    $source = New-Object System.Drawing.Bitmap($sourceW, $sourceH)
    $sourceGraphics = [System.Drawing.Graphics]::FromImage($source)
    $sourceGraphics.CopyFromScreen([int]$r.Left, [int]$r.Top, 0, 0, $source.Size)
    $bmp = New-Object System.Drawing.Bitmap($w, $h)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.DrawImage($source, 0, 0, $w, $h)
    $ms = New-Object System.IO.MemoryStream
    $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    $sourceGraphics.Dispose()
    $source.Dispose()
    $g.Dispose()
    $bmp.Dispose()
    return @{
      data = [Convert]::ToBase64String($ms.ToArray())
      mimeType = "image/png"
      width = $w
      height = $h
      scaleFactor = $scale
      screenBounds = Bounds-Of $el
    }
  } catch {
    return $null
  }
}

function Walk-Elements($root) {
  $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
  $queue = New-Object System.Collections.Queue
  $queue.Enqueue($root)
  $out = @()
  while ($queue.Count -gt 0 -and $out.Count -lt 400) {
    $el = $queue.Dequeue()
    $idx = $out.Count
    $value = $null
    $vp = $null
    if ($el.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$vp)) {
      try { $value = $vp.Current.Value } catch {}
    }
    $out += [pscustomobject]@{
      elementId = "uia:$idx"
      role = $el.Current.ControlType.ProgrammaticName
      label = $el.Current.Name
      value = $value
      enabled = [bool]$el.Current.IsEnabled
      bounds = Bounds-Of $el
      patterns = Pattern-Names $el
      nativeWindowHandle = [int]$el.Current.NativeWindowHandle
      automationId = $el.Current.AutomationId
    }
    $child = $walker.GetFirstChild($el)
    while ($null -ne $child) {
      $queue.Enqueue($child)
      $child = $walker.GetNextSibling($child)
    }
  }
  return $out
}

function Find-Window($target) {
  $root = [System.Windows.Automation.AutomationElement]::RootElement
  if ($target.windowId) {
    $cond = New-Object System.Windows.Automation.PropertyCondition(
      [System.Windows.Automation.AutomationElement]::NativeWindowHandleProperty,
      [int]$target.windowId
    )
    $found = $root.FindFirst([System.Windows.Automation.TreeScope]::Children, $cond)
    if ($null -ne $found) { return $found }
  }
  if ($target.processId) {
    $cond = New-Object System.Windows.Automation.PropertyCondition(
      [System.Windows.Automation.AutomationElement]::ProcessIdProperty,
      [int]$target.processId
    )
    $found = $root.FindFirst([System.Windows.Automation.TreeScope]::Children, $cond)
    if ($null -ne $found) { return $found }
  }
  if ($target.appName) {
    $wins = $root.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
    foreach ($win in $wins) {
      $name = $win.Current.Name
      if ($null -eq $name) { $name = "" }
      if ($name -like ("*" + $target.appName + "*")) { return $win }
    }
  }
  return $null
}

function Find-Element-By-Id($window, $elementId) {
  $indexText = ([string]$elementId).Replace("uia:", "")
  $index = 0
  if (-not [int]::TryParse($indexText, [ref]$index)) { return $null }
  $elements = Walk-Elements $window
  if ($index -lt 0 -or $index -ge $elements.Count) { return $null }

  $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
  $queue = New-Object System.Collections.Queue
  $queue.Enqueue($window)
  $i = 0
  while ($queue.Count -gt 0 -and $i -le $index) {
    $el = $queue.Dequeue()
    if ($i -eq $index) { return $el }
    $i += 1
    $child = $walker.GetFirstChild($el)
    while ($null -ne $child) {
      $queue.Enqueue($child)
      $child = $walker.GetNextSibling($child)
    }
  }
  return $null
}

function Test-Element-Matches-Snapshot($el, $snapshot) {
  if ($null -eq $snapshot) {
    return @{ ok = $false; reason = "missing-snapshot-element" }
  }
  $role = ""
  $label = ""
  $automationId = ""
  $nativeWindowHandle = 0
  try { $role = [string]$el.Current.ControlType.ProgrammaticName } catch {}
  try { $label = [string]$el.Current.Name } catch {}
  try { $automationId = [string]$el.Current.AutomationId } catch {}
  try { $nativeWindowHandle = [int]$el.Current.NativeWindowHandle } catch {}

  if ($snapshot.role -and ([string]$snapshot.role) -ne $role) {
    return @{ ok = $false; reason = "role-mismatch"; expected = $snapshot.role; actual = $role }
  }
  if ($snapshot.automationId -and ([string]$snapshot.automationId) -ne $automationId) {
    return @{ ok = $false; reason = "automation-id-mismatch"; expected = $snapshot.automationId; actual = $automationId }
  }
  if ($snapshot.label -and ([string]$snapshot.label) -ne $label) {
    return @{ ok = $false; reason = "label-mismatch"; expected = $snapshot.label; actual = $label }
  }
  if ($snapshot.nativeWindowHandle -and ([int]$snapshot.nativeWindowHandle) -ne 0 -and ([int]$snapshot.nativeWindowHandle) -ne $nativeWindowHandle) {
    return @{ ok = $false; reason = "native-window-handle-mismatch"; expected = $snapshot.nativeWindowHandle; actual = $nativeWindowHandle }
  }

  $hasStableText = ($snapshot.automationId -or $snapshot.label)
  if (-not $hasStableText -and $snapshot.bounds) {
    $current = Bounds-Of $el
    $expectedCenterX = [double]$snapshot.bounds.x + ([double]$snapshot.bounds.width / 2.0)
    $expectedCenterY = [double]$snapshot.bounds.y + ([double]$snapshot.bounds.height / 2.0)
    $currentCenterX = [double]$current.x + ([double]$current.width / 2.0)
    $currentCenterY = [double]$current.y + ([double]$current.height / 2.0)
    $distance = [Math]::Sqrt([Math]::Pow($expectedCenterX - $currentCenterX, 2) + [Math]::Pow($expectedCenterY - $currentCenterY, 2))
    $tolerance = [Math]::Max(48.0, [Math]::Max([double]$snapshot.bounds.width, [double]$snapshot.bounds.height) * 0.75)
    if ($distance -gt $tolerance) {
      return @{ ok = $false; reason = "bounds-mismatch"; expected = $snapshot.bounds; actual = $current }
    }
  }

  return @{ ok = $true }
}

function List-Apps() {
  $root = [System.Windows.Automation.AutomationElement]::RootElement
  $wins = $root.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
  $items = @()
  foreach ($win in $wins) {
    $pid = [int]$win.Current.ProcessId
    $name = $win.Current.Name
    $handle = [int]$win.Current.NativeWindowHandle
    if ($pid -le 0 -or $handle -le 0) { continue }
    $items += [pscustomobject]@{
      appId = "pid:$pid"
      name = $name
      processId = $pid
      windows = @([pscustomobject]@{
        windowId = "$handle"
        title = $name
        bounds = Bounds-Of $win
      })
    }
  }
  return $items
}

function Invoke-Element($el) {
  $p = $null
  if ($el.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$p)) { $p.Invoke(); return "InvokePattern" }
  if ($el.TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern, [ref]$p)) { $p.Select(); return "SelectionItemPattern" }
  if ($el.TryGetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern, [ref]$p)) { $p.Toggle(); return "TogglePattern" }
  if ($el.TryGetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern, [ref]$p)) { $p.Expand(); return "ExpandCollapsePattern" }
  throw "Element does not support an invokable UIA pattern."
}

function Set-Element-Value($el, $text) {
  $p = $null
  if ($el.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$p)) {
    $p.SetValue([string]$text)
    return "ValuePattern"
  }
  throw "Element does not support ValuePattern."
}

function Scroll-Element($el, $direction, $amount) {
  $p = $null
  if (-not $el.TryGetCurrentPattern([System.Windows.Automation.ScrollPattern]::Pattern, [ref]$p)) {
    throw "Element does not support ScrollPattern."
  }
  $n = [double]([Math]::Max(1, [Math]::Min(50, [int]$amount)))
  if ($direction -eq "down") { $p.ScrollVertical([System.Windows.Automation.ScrollAmount]::LargeIncrement) }
  elseif ($direction -eq "up") { $p.ScrollVertical([System.Windows.Automation.ScrollAmount]::LargeDecrement) }
  elseif ($direction -eq "right") { $p.ScrollHorizontal([System.Windows.Automation.ScrollAmount]::LargeIncrement) }
  elseif ($direction -eq "left") { $p.ScrollHorizontal([System.Windows.Automation.ScrollAmount]::LargeDecrement) }
  return "ScrollPattern"
}

function Window-Point($window, $x, $y, $snapshotDisplay) {
  $r = $window.Current.BoundingRectangle
  $scale = 1.0
  if ($snapshotDisplay -and $snapshotDisplay.scaleFactor) {
    $scale = [double]$snapshotDisplay.scaleFactor
    if ($scale -le 0) { $scale = 1.0 }
  }
  return @{
    x = [int]([Math]::Round($r.Left + ([double]$x / $scale)))
    y = [int]([Math]::Round($r.Top + ([double]$y / $scale)))
  }
}

function Window-Center($window) {
  $r = $window.Current.BoundingRectangle
  return @{
    x = [int]([Math]::Round($r.Left + ($r.Width / 2)))
    y = [int]([Math]::Round($r.Top + ($r.Height / 2)))
  }
}

function Element-Center($el) {
  $r = $el.Current.BoundingRectangle
  return @{
    x = [int]([Math]::Round($r.Left + ($r.Width / 2)))
    y = [int]([Math]::Round($r.Top + ($r.Height / 2)))
  }
}

function Foreground-Required($message, $details) {
  return @{
    ok = $false
    errorCode = "ACTION_REQUIRES_FOREGROUND"
    message = $message
    details = $details
  }
}

function Stale-Snapshot-Result($action, $match) {
  return @{
    ok = $false
    errorCode = "STALE_SNAPSHOT"
    message = "Element no longer matches the latest UIA snapshot. Refresh app state before retrying."
    details = @{
      action = $action.type
      elementId = $action.elementId
      snapshotId = $action.snapshotId
      reason = $match.reason
      expected = $match.expected
      actual = $match.actual
    }
  }
}

try {
  Add-Type -AssemblyName UIAutomationClient
  Add-Type -AssemblyName UIAutomationTypes
  $inputJson = [Console]::In.ReadToEnd()
  if ([string]::IsNullOrWhiteSpace($inputJson)) { throw "Missing helper request JSON." }
  $req = $inputJson | ConvertFrom-Json

  if ($req.command -eq "status") {
    Write-Result @{ ok = $true; data = @{ available = $true; permissions = @() } }
    exit 0
  }

  if ($req.command -eq "list_apps") {
    Write-Result @{ ok = $true; data = @{ apps = @(List-Apps) } }
    exit 0
  }

  $window = Find-Window $req.target
  if ($null -eq $window) {
    Write-Result @{ ok = $false; errorCode = "TARGET_NOT_FOUND"; message = "Window not found." }
    exit 0
  }

  if ($req.command -eq "get_app_state") {
    $elements = Walk-Elements $window
    $capture = Capture-Element $window
    if ($null -eq $capture) {
      Write-Result @{ ok = $false; errorCode = "PROVIDER_CRASHED"; message = "Unable to capture target window screenshot." }
      exit 0
    }
    $windowBounds = Bounds-Of $window
    Write-Result @{ ok = $true; data = @{
      appId = if ($req.target.appId) { $req.target.appId } else { "pid:" + $window.Current.ProcessId }
      windowId = "" + $window.Current.NativeWindowHandle
      screenshot = $capture
      display = @{
        x = 0
        y = 0
        width = $capture.width
        height = $capture.height
        scaleFactor = $capture.scaleFactor
        screenBounds = $windowBounds
      }
      elements = @($elements)
      providerState = @{
        processId = [int]$window.Current.ProcessId
        windowId = [int]$window.Current.NativeWindowHandle
        appName = $window.Current.Name
        windowBounds = $windowBounds
      }
    } }
    exit 0
  }

  if ($req.command -eq "perform_action") {
    if ($req.action.type -eq "stop") {
      Write-Result @{ ok = $true; data = @{ ok = $true; action = "stop" } }
      exit 0
    }
    if ($req.action.type -eq "click_point") {
      $pt = Window-Point $window $req.action.x $req.action.y $req.action.snapshotDisplay
      Write-Result (Foreground-Required "Windows UIA is configured for background-only control; click_point would require foreground input." @{
        action = "click_point"
        x = $pt.x
        y = $pt.y
      })
      exit 0
    }
    if ($req.action.type -eq "double_click" -and -not $req.action.elementId) {
      $pt = Window-Point $window $req.action.x $req.action.y $req.action.snapshotDisplay
      Write-Result (Foreground-Required "Windows UIA is configured for background-only control; double_click would require foreground input." @{
        action = "double_click"
        x = $pt.x
        y = $pt.y
      })
      exit 0
    }
    if ($req.action.type -eq "drag") {
      $from = Window-Point $window $req.action.fromX $req.action.fromY $req.action.snapshotDisplay
      $to = Window-Point $window $req.action.toX $req.action.toY $req.action.snapshotDisplay
      Write-Result (Foreground-Required "Windows UIA is configured for background-only control; drag would require foreground input." @{
        action = "drag"
        from = $from
        to = $to
      })
      exit 0
    }
    if ($req.action.type -eq "press_key") {
      Write-Result (Foreground-Required "Windows UIA is configured for background-only control; press_key would require foreground input." @{
        action = "press_key"
        key = $req.action.key
      })
      exit 0
    }
    if ($req.action.type -eq "type_text" -and -not $req.action.elementId) {
      Write-Result (Foreground-Required "Windows UIA is configured for background-only control; type_text without an element would require foreground input." @{
        action = "type_text"
        textLength = ([string]$req.action.text).Length
      })
      exit 0
    }
    if ($req.action.type -eq "scroll" -and -not $req.action.elementId) {
      if ($req.action.x -ne $null -and $req.action.y -ne $null) {
        $pt = Window-Point $window $req.action.x $req.action.y $req.action.snapshotDisplay
      } else {
        $pt = Window-Center $window
      }
      Write-Result (Foreground-Required "Windows UIA is configured for background-only control; scroll without an element would require foreground input." @{
        action = "scroll"
        x = $pt.x
        y = $pt.y
        direction = $req.action.direction
      })
      exit 0
    }

    $el = Find-Element-By-Id $window $req.action.elementId
    if ($null -eq $el) {
      Write-Result @{ ok = $false; errorCode = "TARGET_NOT_FOUND"; message = "Element not found." }
      exit 0
    }

    $match = Test-Element-Matches-Snapshot $el $req.action.snapshotElement
    if (-not $match.ok) {
      Write-Result (Stale-Snapshot-Result $req.action $match)
      exit 0
    }

    if ($req.action.type -eq "click_element") {
      try {
        $pattern = Invoke-Element $el
        Write-Result @{ ok = $true; data = @{ ok = $true; mode = "background"; pattern = $pattern } }
      } catch {
        Write-Result (Foreground-Required "Element does not expose a UIA invoke pattern, and foreground input is disabled." @{
          elementId = $req.action.elementId
          bounds = Bounds-Of $el
        })
      }
      exit 0
    }
    if ($req.action.type -eq "double_click") {
      $pt = Element-Center $el
      Write-Result (Foreground-Required "Windows UIA is configured for background-only control; double_click would require foreground input." @{
        action = "double_click"
        elementId = $req.action.elementId
        x = $pt.x
        y = $pt.y
      })
      exit 0
    }
    if ($req.action.type -eq "type_text") {
      try {
        $pattern = Set-Element-Value $el $req.action.text
        Write-Result @{ ok = $true; data = @{ ok = $true; mode = "background"; pattern = $pattern } }
      } catch {
        Write-Result (Foreground-Required "Element does not expose ValuePattern, and foreground text input is disabled." @{
          elementId = $req.action.elementId
          bounds = Bounds-Of $el
        })
      }
      exit 0
    }
    if ($req.action.type -eq "scroll") {
      try {
        $pattern = Scroll-Element $el $req.action.direction $req.action.amount
        Write-Result @{ ok = $true; data = @{ ok = $true; mode = "background"; pattern = $pattern } }
      } catch {
        Write-Result (Foreground-Required "Element does not expose ScrollPattern, and foreground wheel input is disabled." @{
          suggestedAction = "scroll"
          elementId = $req.action.elementId
          bounds = Bounds-Of $el
        })
      }
      exit 0
    }
  }

  Write-Result @{ ok = $false; errorCode = "CAPABILITY_UNSUPPORTED"; message = "Unsupported helper command." }
  exit 0
} catch {
  Write-Result @{ ok = $false; errorCode = "PROVIDER_CRASHED"; message = $_.Exception.Message }
  exit 0
}
`;
