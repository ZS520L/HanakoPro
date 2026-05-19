import { redactLogText, redactLogValue } from "../log-redactor.js";

export function summarizeBrowserActionParams(action, params = {}) {
  if (!params || typeof params !== "object") return {};

  switch (action) {
    case "type":
      return compact({
        ref: redactLogText(params.ref),
        textLength: typeof params.text === "string" ? params.text.length : 0,
        pressEnter: params.pressEnter === true ? true : undefined,
      });

    case "evaluate":
      return {
        expressionLength: typeof params.expression === "string" ? params.expression.length : 0,
      };

    case "navigate":
      return compact({
        url: redactLogText(params.url),
      });

    case "click":
      return compact({ ref: redactLogText(params.ref) });

    case "select":
      return compact({
        ref: redactLogText(params.ref),
        valueLength: typeof params.value === "string" ? params.value.length : undefined,
      });

    case "scroll":
      return compact({
        direction: redactLogText(params.direction),
        amount: params.amount,
      });

    case "key":
      return compact({ key: redactLogText(params.key) });

    case "wait":
      return compact({
        timeout: params.timeout,
        state: redactLogText(params.state),
      });

    default:
      return redactLogValue(params);
  }
}

function compact(value) {
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    if (item !== undefined && item !== null && item !== "") out[key] = item;
  }
  return out;
}
