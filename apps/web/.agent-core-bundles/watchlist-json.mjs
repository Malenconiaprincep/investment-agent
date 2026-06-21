var __getOwnPropNames = Object.getOwnPropertyNames;
var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
  get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
}) : x)(function(x) {
  if (typeof require !== "undefined") return require.apply(this, arguments);
  throw Error('Dynamic require of "' + x + '" is not supported');
});
var __esm = (fn, res, err) => function __init() {
  if (err) throw err[0];
  try {
    return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
  } catch (e) {
    throw err = [e], e;
  }
};
var __commonJS = (cb, mod) => function __require2() {
  try {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  } catch (e) {
    throw mod = 0, e;
  }
};

// ../../node_modules/.pnpm/dotenv@17.4.2/node_modules/dotenv/lib/main.js
var require_main = __commonJS({
  "../../node_modules/.pnpm/dotenv@17.4.2/node_modules/dotenv/lib/main.js"(exports, module) {
    var fs = __require("fs");
    var path3 = __require("path");
    var os = __require("os");
    var crypto2 = __require("crypto");
    var TIPS = [
      "\u25C8 encrypted .env [www.dotenvx.com]",
      "\u25C8 secrets for agents [www.dotenvx.com]",
      "\u2301 auth for agents [www.vestauth.com]",
      "\u2318 custom filepath { path: '/custom/path/.env' }",
      "\u2318 enable debugging { debug: true }",
      "\u2318 override existing { override: true }",
      "\u2318 suppress logs { quiet: true }",
      "\u2318 multiple files { path: ['.env.local', '.env'] }"
    ];
    function _getRandomTip() {
      return TIPS[Math.floor(Math.random() * TIPS.length)];
    }
    function parseBoolean(value) {
      if (typeof value === "string") {
        return !["false", "0", "no", "off", ""].includes(value.toLowerCase());
      }
      return Boolean(value);
    }
    function supportsAnsi() {
      return process.stdout.isTTY;
    }
    function dim(text) {
      return supportsAnsi() ? `\x1B[2m${text}\x1B[0m` : text;
    }
    var LINE = /(?:^|^)\s*(?:export\s+)?([\w.-]+)(?:\s*=\s*?|:\s+?)(\s*'(?:\\'|[^'])*'|\s*"(?:\\"|[^"])*"|\s*`(?:\\`|[^`])*`|[^#\r\n]+)?\s*(?:#.*)?(?:$|$)/mg;
    function parse(src) {
      const obj = {};
      let lines = src.toString();
      lines = lines.replace(/\r\n?/mg, "\n");
      let match;
      while ((match = LINE.exec(lines)) != null) {
        const key = match[1];
        let value = match[2] || "";
        value = value.trim();
        const maybeQuote = value[0];
        value = value.replace(/^(['"`])([\s\S]*)\1$/mg, "$2");
        if (maybeQuote === '"') {
          value = value.replace(/\\n/g, "\n");
          value = value.replace(/\\r/g, "\r");
        }
        obj[key] = value;
      }
      return obj;
    }
    function _parseVault(options) {
      options = options || {};
      const vaultPath = _vaultPath(options);
      options.path = vaultPath;
      const result = DotenvModule.configDotenv(options);
      if (!result.parsed) {
        const err = new Error(`MISSING_DATA: Cannot parse ${vaultPath} for an unknown reason`);
        err.code = "MISSING_DATA";
        throw err;
      }
      const keys = _dotenvKey(options).split(",");
      const length = keys.length;
      let decrypted;
      for (let i = 0; i < length; i++) {
        try {
          const key = keys[i].trim();
          const attrs = _instructions(result, key);
          decrypted = DotenvModule.decrypt(attrs.ciphertext, attrs.key);
          break;
        } catch (error) {
          if (i + 1 >= length) {
            throw error;
          }
        }
      }
      return DotenvModule.parse(decrypted);
    }
    function _warn(message) {
      console.error(`\u26A0 ${message}`);
    }
    function _debug(message) {
      console.log(`\u2506 ${message}`);
    }
    function _log(message) {
      console.log(`\u25C7 ${message}`);
    }
    function _dotenvKey(options) {
      if (options && options.DOTENV_KEY && options.DOTENV_KEY.length > 0) {
        return options.DOTENV_KEY;
      }
      if (process.env.DOTENV_KEY && process.env.DOTENV_KEY.length > 0) {
        return process.env.DOTENV_KEY;
      }
      return "";
    }
    function _instructions(result, dotenvKey) {
      let uri;
      try {
        uri = new URL(dotenvKey);
      } catch (error) {
        if (error.code === "ERR_INVALID_URL") {
          const err = new Error("INVALID_DOTENV_KEY: Wrong format. Must be in valid uri format like dotenv://:key_1234@dotenvx.com/vault/.env.vault?environment=development");
          err.code = "INVALID_DOTENV_KEY";
          throw err;
        }
        throw error;
      }
      const key = uri.password;
      if (!key) {
        const err = new Error("INVALID_DOTENV_KEY: Missing key part");
        err.code = "INVALID_DOTENV_KEY";
        throw err;
      }
      const environment = uri.searchParams.get("environment");
      if (!environment) {
        const err = new Error("INVALID_DOTENV_KEY: Missing environment part");
        err.code = "INVALID_DOTENV_KEY";
        throw err;
      }
      const environmentKey = `DOTENV_VAULT_${environment.toUpperCase()}`;
      const ciphertext = result.parsed[environmentKey];
      if (!ciphertext) {
        const err = new Error(`NOT_FOUND_DOTENV_ENVIRONMENT: Cannot locate environment ${environmentKey} in your .env.vault file.`);
        err.code = "NOT_FOUND_DOTENV_ENVIRONMENT";
        throw err;
      }
      return { ciphertext, key };
    }
    function _vaultPath(options) {
      let possibleVaultPath = null;
      if (options && options.path && options.path.length > 0) {
        if (Array.isArray(options.path)) {
          for (const filepath of options.path) {
            if (fs.existsSync(filepath)) {
              possibleVaultPath = filepath.endsWith(".vault") ? filepath : `${filepath}.vault`;
            }
          }
        } else {
          possibleVaultPath = options.path.endsWith(".vault") ? options.path : `${options.path}.vault`;
        }
      } else {
        possibleVaultPath = path3.resolve(process.cwd(), ".env.vault");
      }
      if (fs.existsSync(possibleVaultPath)) {
        return possibleVaultPath;
      }
      return null;
    }
    function _resolveHome(envPath) {
      return envPath[0] === "~" ? path3.join(os.homedir(), envPath.slice(1)) : envPath;
    }
    function _configVault(options) {
      const debug = parseBoolean(process.env.DOTENV_CONFIG_DEBUG || options && options.debug);
      const quiet = parseBoolean(process.env.DOTENV_CONFIG_QUIET || options && options.quiet);
      if (debug || !quiet) {
        _log("loading env from encrypted .env.vault");
      }
      const parsed = DotenvModule._parseVault(options);
      let processEnv = process.env;
      if (options && options.processEnv != null) {
        processEnv = options.processEnv;
      }
      DotenvModule.populate(processEnv, parsed, options);
      return { parsed };
    }
    function configDotenv(options) {
      const dotenvPath = path3.resolve(process.cwd(), ".env");
      let encoding = "utf8";
      let processEnv = process.env;
      if (options && options.processEnv != null) {
        processEnv = options.processEnv;
      }
      let debug = parseBoolean(processEnv.DOTENV_CONFIG_DEBUG || options && options.debug);
      let quiet = parseBoolean(processEnv.DOTENV_CONFIG_QUIET || options && options.quiet);
      if (options && options.encoding) {
        encoding = options.encoding;
      } else {
        if (debug) {
          _debug("no encoding is specified (UTF-8 is used by default)");
        }
      }
      let optionPaths = [dotenvPath];
      if (options && options.path) {
        if (!Array.isArray(options.path)) {
          optionPaths = [_resolveHome(options.path)];
        } else {
          optionPaths = [];
          for (const filepath of options.path) {
            optionPaths.push(_resolveHome(filepath));
          }
        }
      }
      let lastError;
      const parsedAll = {};
      for (const path4 of optionPaths) {
        try {
          const parsed = DotenvModule.parse(fs.readFileSync(path4, { encoding }));
          DotenvModule.populate(parsedAll, parsed, options);
        } catch (e) {
          if (debug) {
            _debug(`failed to load ${path4} ${e.message}`);
          }
          lastError = e;
        }
      }
      const populated = DotenvModule.populate(processEnv, parsedAll, options);
      debug = parseBoolean(processEnv.DOTENV_CONFIG_DEBUG || debug);
      quiet = parseBoolean(processEnv.DOTENV_CONFIG_QUIET || quiet);
      if (debug || !quiet) {
        const keysCount = Object.keys(populated).length;
        const shortPaths = [];
        for (const filePath of optionPaths) {
          try {
            const relative = path3.relative(process.cwd(), filePath);
            shortPaths.push(relative);
          } catch (e) {
            if (debug) {
              _debug(`failed to load ${filePath} ${e.message}`);
            }
            lastError = e;
          }
        }
        _log(`injected env (${keysCount}) from ${shortPaths.join(",")} ${dim(`// tip: ${_getRandomTip()}`)}`);
      }
      if (lastError) {
        return { parsed: parsedAll, error: lastError };
      } else {
        return { parsed: parsedAll };
      }
    }
    function config(options) {
      if (_dotenvKey(options).length === 0) {
        return DotenvModule.configDotenv(options);
      }
      const vaultPath = _vaultPath(options);
      if (!vaultPath) {
        _warn(`you set DOTENV_KEY but you are missing a .env.vault file at ${vaultPath}`);
        return DotenvModule.configDotenv(options);
      }
      return DotenvModule._configVault(options);
    }
    function decrypt(encrypted, keyStr) {
      const key = Buffer.from(keyStr.slice(-64), "hex");
      let ciphertext = Buffer.from(encrypted, "base64");
      const nonce = ciphertext.subarray(0, 12);
      const authTag = ciphertext.subarray(-16);
      ciphertext = ciphertext.subarray(12, -16);
      try {
        const aesgcm = crypto2.createDecipheriv("aes-256-gcm", key, nonce);
        aesgcm.setAuthTag(authTag);
        return `${aesgcm.update(ciphertext)}${aesgcm.final()}`;
      } catch (error) {
        const isRange = error instanceof RangeError;
        const invalidKeyLength = error.message === "Invalid key length";
        const decryptionFailed = error.message === "Unsupported state or unable to authenticate data";
        if (isRange || invalidKeyLength) {
          const err = new Error("INVALID_DOTENV_KEY: It must be 64 characters long (or more)");
          err.code = "INVALID_DOTENV_KEY";
          throw err;
        } else if (decryptionFailed) {
          const err = new Error("DECRYPTION_FAILED: Please check your DOTENV_KEY");
          err.code = "DECRYPTION_FAILED";
          throw err;
        } else {
          throw error;
        }
      }
    }
    function populate(processEnv, parsed, options = {}) {
      const debug = Boolean(options && options.debug);
      const override = Boolean(options && options.override);
      const populated = {};
      if (typeof parsed !== "object") {
        const err = new Error("OBJECT_REQUIRED: Please check the processEnv argument being passed to populate");
        err.code = "OBJECT_REQUIRED";
        throw err;
      }
      for (const key of Object.keys(parsed)) {
        if (Object.prototype.hasOwnProperty.call(processEnv, key)) {
          if (override === true) {
            processEnv[key] = parsed[key];
            populated[key] = parsed[key];
          }
          if (debug) {
            if (override === true) {
              _debug(`"${key}" is already defined and WAS overwritten`);
            } else {
              _debug(`"${key}" is already defined and was NOT overwritten`);
            }
          }
        } else {
          processEnv[key] = parsed[key];
          populated[key] = parsed[key];
        }
      }
      return populated;
    }
    var DotenvModule = {
      configDotenv,
      _configVault,
      _parseVault,
      config,
      decrypt,
      parse,
      populate
    };
    module.exports.configDotenv = DotenvModule.configDotenv;
    module.exports._configVault = DotenvModule._configVault;
    module.exports._parseVault = DotenvModule._parseVault;
    module.exports.config = DotenvModule.config;
    module.exports.decrypt = DotenvModule.decrypt;
    module.exports.parse = DotenvModule.parse;
    module.exports.populate = DotenvModule.populate;
    module.exports = DotenvModule;
  }
});

// ../../node_modules/.pnpm/dotenv@17.4.2/node_modules/dotenv/lib/env-options.js
var require_env_options = __commonJS({
  "../../node_modules/.pnpm/dotenv@17.4.2/node_modules/dotenv/lib/env-options.js"(exports, module) {
    var options = {};
    if (process.env.DOTENV_CONFIG_ENCODING != null) {
      options.encoding = process.env.DOTENV_CONFIG_ENCODING;
    }
    if (process.env.DOTENV_CONFIG_PATH != null) {
      options.path = process.env.DOTENV_CONFIG_PATH;
    }
    if (process.env.DOTENV_CONFIG_QUIET != null) {
      options.quiet = process.env.DOTENV_CONFIG_QUIET;
    }
    if (process.env.DOTENV_CONFIG_DEBUG != null) {
      options.debug = process.env.DOTENV_CONFIG_DEBUG;
    }
    if (process.env.DOTENV_CONFIG_OVERRIDE != null) {
      options.override = process.env.DOTENV_CONFIG_OVERRIDE;
    }
    if (process.env.DOTENV_CONFIG_DOTENV_KEY != null) {
      options.DOTENV_KEY = process.env.DOTENV_CONFIG_DOTENV_KEY;
    }
    module.exports = options;
  }
});

// ../../node_modules/.pnpm/dotenv@17.4.2/node_modules/dotenv/lib/cli-options.js
var require_cli_options = __commonJS({
  "../../node_modules/.pnpm/dotenv@17.4.2/node_modules/dotenv/lib/cli-options.js"(exports, module) {
    var re = /^dotenv_config_(encoding|path|quiet|debug|override|DOTENV_KEY)=(.+)$/;
    module.exports = function optionMatcher(args) {
      const options = args.reduce(function(acc, cur) {
        const matches = cur.match(re);
        if (matches) {
          acc[matches[1]] = matches[2];
        }
        return acc;
      }, {});
      if (!("quiet" in options)) {
        options.quiet = "true";
      }
      return options;
    };
  }
});

// ../../packages/agent-core/src/data/paper/trading-calendar.ts
function getBeijingNow() {
  return new Date((/* @__PURE__ */ new Date()).toLocaleString("en-US", { timeZone: "Asia/Shanghai" }));
}
function formatTradeDate(date = getBeijingNow()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
var init_trading_calendar = __esm({
  "../../packages/agent-core/src/data/paper/trading-calendar.ts"() {
    "use strict";
  }
});

// ../../node_modules/.pnpm/dotenv@17.4.2/node_modules/dotenv/config.js
(function() {
  require_main().config(
    Object.assign(
      {},
      require_env_options(),
      require_cli_options()(process.argv)
    )
  );
})();

// ../../packages/agent-core/src/data/market/cache.ts
var store = /* @__PURE__ */ new Map();
function getCached(key) {
  const entry = store.get(key);
  if (!entry) return void 0;
  if (Date.now() > entry.expiresAt) {
    store.delete(key);
    return void 0;
  }
  return entry.value;
}
function setCached(key, value, ttlMs) {
  store.set(key, { value, expiresAt: Date.now() + ttlMs });
}

// ../../packages/agent-core/src/lib/retry.ts
var DEFAULT_SHOULD_RETRY = (error) => {
  if (error instanceof Error) {
    return /timeout|ECONNRESET|ENOTFOUND|429|503/i.test(error.message);
  }
  return false;
};
async function retryWithBackoff(fn, options = {}) {
  const {
    maxAttempts = 3,
    baseDelayMs = 300,
    maxDelayMs = 3e3,
    shouldRetry = DEFAULT_SHOULD_RETRY
  } = options;
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt >= maxAttempts || !shouldRetry(error, attempt)) {
        throw error;
      }
      const delay = Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}

// ../../packages/agent-core/src/lib/safe-fetch.ts
var DEFAULT_ALLOWED_HOSTS = [
  "api.deepseek.com",
  "geocoding-api.open-meteo.com",
  "api.open-meteo.com"
];
async function safeFetch(url, init, options = {}) {
  const {
    timeoutMs = 1e4,
    allowedHosts = DEFAULT_ALLOWED_HOSTS,
    retries = 2
  } = options;
  const parsed = new URL(url);
  if (!allowedHosts.includes(parsed.hostname)) {
    throw new Error(
      `Host not allowed: ${parsed.hostname}. Allowed: ${allowedHosts.join(", ")}`
    );
  }
  return retryWithBackoff(
    async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetch(url, {
          ...init,
          signal: controller.signal
        });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status} for ${url}`);
        }
        return response;
      } finally {
        clearTimeout(timer);
      }
    },
    { maxAttempts: retries + 1 }
  );
}

// ../../packages/agent-core/src/data/market/free/http.ts
var FREE_ALLOWED_HOSTS = [
  "push2delay.eastmoney.com",
  "emweb.securities.eastmoney.com",
  "np-anotice-stock.eastmoney.com",
  "search-api-web.eastmoney.com",
  "np-listapi.eastmoney.com",
  "np-weblist.eastmoney.com",
  "web.ifzq.gtimg.cn",
  "feed.mix.sina.com.cn"
];
var DEFAULT_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
  Referer: "https://emweb.securities.eastmoney.com/"
};
async function freeFetchJson(url, init) {
  const response = await safeFetch(
    url,
    {
      ...init,
      headers: {
        ...DEFAULT_HEADERS,
        ...init?.headers
      }
    },
    { allowedHosts: FREE_ALLOWED_HOSTS, retries: 2 }
  );
  return await response.json();
}
function toSecId(symbol) {
  const code = symbol.trim();
  if (code.startsWith("6")) return `1.${code}`;
  if (code.startsWith("0") || code.startsWith("3")) return `0.${code}`;
  if (code.startsWith("8") || code.startsWith("4")) return `0.${code}`;
  throw new Error(`\u65E0\u6CD5\u8BC6\u522B\u4EA4\u6613\u6240: ${symbol}`);
}
function toMarketCode(symbol) {
  const code = symbol.trim();
  if (code.startsWith("6")) return `SH${code}`;
  if (code.startsWith("0") || code.startsWith("3")) return `SZ${code}`;
  if (code.startsWith("8") || code.startsWith("4")) return `BJ${code}`;
  throw new Error(`\u65E0\u6CD5\u8BC6\u522B\u4EA4\u6613\u6240: ${symbol}`);
}

// ../../packages/agent-core/src/data/market/free/eastmoney.ts
var TTL_MS = {
  snapshot: 30 * 60 * 1e3,
  profile: 24 * 60 * 60 * 1e3,
  financial: 24 * 60 * 60 * 1e3,
  announcements: 6 * 60 * 60 * 1e3,
  news: 60 * 60 * 1e3,
  industry: 24 * 60 * 60 * 1e3
};
async function fetchStockSnapshot(symbol) {
  const cacheKey = `em:snapshot:${symbol}`;
  const cached = getCached(cacheKey);
  if (cached) return { data: cached, cached: true };
  const secid = toSecId(symbol);
  const json = await freeFetchJson(
    `https://push2delay.eastmoney.com/api/qt/stock/get?secid=${secid}&fields=f57,f58,f127,f162,f167`
  );
  if (!json.data?.f57) {
    throw new Error(`\u672A\u627E\u5230\u80A1\u7968: ${symbol}`);
  }
  const data = mapSnapshot(symbol, json.data);
  setCached(cacheKey, data, TTL_MS.snapshot);
  return { data, cached: false };
}
function mapSnapshot(symbol, raw) {
  return {
    symbol: String(raw.f57 ?? symbol),
    name: String(raw.f58 ?? ""),
    industry: raw.f127 != null ? String(raw.f127) : null,
    pe: raw.f162 != null ? Number(raw.f162) / 100 : null,
    pb: raw.f167 != null ? Number(raw.f167) / 100 : null
  };
}
async function fetchCompanyProfile(symbol) {
  const cacheKey = `em:profile:${symbol}`;
  const cached = getCached(cacheKey);
  if (cached) return { data: cached, cached: true };
  const code = toMarketCode(symbol);
  const json = await freeFetchJson(
    `https://emweb.securities.eastmoney.com/PC_HSF10/CompanySurvey/PageAjax?code=${code}`
  );
  const data = mapProfile(json);
  setCached(cacheKey, data, TTL_MS.profile);
  return { data, cached: false };
}
function mapProfile(json) {
  const basic = json.jbzl?.[0];
  const issue = json.fxxg?.[0];
  return {
    area: basic?.PROVINCE != null ? String(basic.PROVINCE) : null,
    industryDetail: basic?.INDUSTRYCSRC1 != null ? String(basic.INDUSTRYCSRC1) : null,
    market: basic?.TRADE_MARKET != null ? String(basic.TRADE_MARKET) : null,
    listDate: issue?.LISTING_DATE != null ? String(issue.LISTING_DATE).slice(0, 10).replace(/-/g, "") : null
  };
}

// ../../packages/agent-core/src/data/market/free/tencent.ts
var TTL_MS2 = 60 * 60 * 1e3;
function toTencentCode(symbol) {
  const code = symbol.trim();
  if (code.startsWith("6")) return `sh${code}`;
  if (code.startsWith("0") || code.startsWith("3")) return `sz${code}`;
  if (code.startsWith("8") || code.startsWith("4")) return `bj${code}`;
  throw new Error(`\u65E0\u6CD5\u8BC6\u522B\u4EA4\u6613\u6240: ${symbol}`);
}
async function fetchDailyKlines(symbol, days) {
  const cacheKey = `tx:kline:${symbol}:${days}`;
  const cached = getCached(cacheKey);
  if (cached) return { quotes: cached, cached: true };
  const txCode = toTencentCode(symbol);
  const url = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${txCode},day,,,${days},qfq`;
  const response = await safeFetch(url, void 0, {
    allowedHosts: ["web.ifzq.gtimg.cn"]
  });
  const json = await response.json();
  const rows = json.data?.[txCode]?.qfqday ?? [];
  if (rows.length === 0) {
    throw new Error(`\u6682\u65E0\u884C\u60C5\u6570\u636E: ${symbol}`);
  }
  const quotes = mapKlines(rows);
  setCached(cacheKey, quotes, TTL_MS2);
  return { quotes, cached: false };
}
function mapKlines(rows) {
  return rows.map(([tradeDate, open, close, high, low, vol]) => {
    const openNum = Number(open);
    const closeNum = Number(close);
    return {
      tradeDate: tradeDate.replace(/-/g, ""),
      open: Number.isFinite(openNum) ? openNum : null,
      high: Number.isFinite(Number(high)) ? Number(high) : null,
      low: Number.isFinite(Number(low)) ? Number(low) : null,
      close: Number.isFinite(closeNum) ? closeNum : null,
      pctChg: Number.isFinite(openNum) && openNum > 0 ? Number(((closeNum - openNum) / openNum * 100).toFixed(2)) : null,
      vol: Number.isFinite(Number(vol)) ? Number(vol) : null,
      amount: null
    };
  }).reverse();
}

// ../../packages/agent-core/src/data/market/types.ts
var MARKET_DISCLAIMER = "\u6570\u636E\u6765\u81EA\u4E1C\u65B9\u8D22\u5BCC/\u817E\u8BAF\u516C\u5F00\u63A5\u53E3\uFF0C\u4EC5\u4F9B\u5B66\u4E60\u7814\u7A76\uFF0C\u4E0D\u6784\u6210\u6295\u8D44\u5EFA\u8BAE\u3002\u63A5\u53E3\u975E\u5B98\u65B9\u6388\u6743\uFF0C\u8BF7\u63A7\u5236\u8BF7\u6C42\u9891\u7387\u3002";

// ../../packages/agent-core/src/data/market/meta.ts
function buildMeta(dataSource, cached) {
  return {
    dataSource,
    asOf: (/* @__PURE__ */ new Date()).toISOString(),
    cached,
    disclaimer: MARKET_DISCLAIMER
  };
}

// ../../packages/agent-core/src/data/market/symbols.ts
function toTsCode(symbol) {
  const code = symbol.trim().toUpperCase();
  if (code.includes(".")) {
    return code;
  }
  if (!/^\d{6}$/.test(code)) {
    throw new Error(`\u65E0\u6548\u80A1\u7968\u4EE3\u7801: ${symbol}\uFF0C\u9700\u8981 6 \u4F4D\u6570\u5B57`);
  }
  if (code.startsWith("6")) return `${code}.SH`;
  if (code.startsWith("0") || code.startsWith("3")) return `${code}.SZ`;
  if (code.startsWith("8") || code.startsWith("4")) return `${code}.BJ`;
  throw new Error(`\u65E0\u6CD5\u8BC6\u522B\u4EA4\u6613\u6240\u540E\u7F00: ${symbol}`);
}
function toSymbol(tsCode) {
  return tsCode.split(".")[0] ?? tsCode;
}

// ../../packages/agent-core/src/data/market/services.ts
async function getStockBasic(symbol) {
  const tsCode = toTsCode(symbol);
  const code = toSymbol(tsCode);
  const [snapshot, profile] = await Promise.all([
    fetchStockSnapshot(code),
    fetchCompanyProfile(code)
  ]);
  return {
    tsCode,
    symbol: snapshot.data.symbol,
    name: snapshot.data.name,
    industry: snapshot.data.industry ?? profile.data.industryDetail,
    area: profile.data.area,
    listDate: profile.data.listDate,
    market: profile.data.market,
    ...buildMeta("eastmoney", snapshot.cached && profile.cached)
  };
}
async function getDailyQuote(symbol, days = 5) {
  const tsCode = toTsCode(symbol);
  const code = toSymbol(tsCode);
  const { quotes, cached } = await fetchDailyKlines(code, days);
  const withPct = quotes.map((quote, index) => {
    const prev = quotes[index + 1];
    const pctChg = prev?.close && quote.close ? Number(((quote.close - prev.close) / prev.close * 100).toFixed(2)) : quote.pctChg;
    return { ...quote, pctChg };
  });
  const latest = withPct[0];
  return {
    tsCode,
    quotes: withPct,
    latestClose: latest?.close ?? null,
    latestPctChg: latest?.pctChg ?? null,
    ...buildMeta("tencent", cached)
  };
}

// ../../packages/agent-core/src/data/market/indicators.ts
function sma(values, period) {
  if (values.length < period) return null;
  const slice = values.slice(0, period);
  return Number((slice.reduce((sum, v) => sum + v, 0) / period).toFixed(4));
}
function emaSeries(values, period) {
  if (values.length === 0) return [];
  const k = 2 / (period + 1);
  const result = [];
  let prev = values[0];
  result.push(prev);
  for (let i = 1; i < values.length; i += 1) {
    prev = values[i] * k + prev * (1 - k);
    result.push(prev);
  }
  return result;
}
function macd(closes, fast = 12, slow = 26, signal = 9) {
  const emaFast = emaSeries(closes, fast);
  const emaSlow = emaSeries(closes, slow);
  const dif = emaFast.map((f, i) => f - emaSlow[i]);
  const dea = emaSeries(dif, signal);
  const hist = dif.map((d, i) => d - dea[i]);
  return { dif, dea, hist };
}
function avgVolume(bars, days) {
  const vols = bars.slice(0, days).map((b) => b.vol).filter((v) => v != null && v > 0);
  if (vols.length === 0) return null;
  return vols.reduce((sum, v) => sum + v, 0) / vols.length;
}
function highestClose(bars, days, skip = 0) {
  const slice = bars.slice(skip, skip + days);
  const closes = slice.map((b) => b.close).filter((c) => c != null);
  if (closes.length === 0) return null;
  return Math.max(...closes);
}

// ../../packages/agent-core/src/data/market/diamond-signal.ts
function barsFromQuote(quotes) {
  return quotes.filter((q) => q.close != null);
}
function detectDiamondSignal(symbol, name, bars) {
  if (bars.length < 30) return null;
  const latest = bars[0];
  const close = latest.close;
  if (close == null) return null;
  const closes = bars.map((b) => b.close).filter((c) => c != null);
  const ma5 = sma(closes, 5);
  const ma20 = sma(closes, 20);
  if (ma5 == null || ma20 == null) return null;
  const volAvg5 = avgVolume(bars, 5);
  const latestVol = latest.vol;
  const volumeRatio = volAvg5 && latestVol ? Number((latestVol / volAvg5).toFixed(2)) : null;
  const { dif, dea, hist } = macd([...closes].reverse());
  const difLatest = dif[dif.length - 1];
  const deaLatest = dea[dea.length - 1];
  const difPrev = dif[dif.length - 2];
  const deaPrev = dea[dea.length - 2];
  const histLatest = hist[hist.length - 1];
  const histPrev = hist[hist.length - 2];
  const macdGoldenCross = difPrev <= deaPrev && difLatest > deaLatest;
  const macdHistTurningPositive = histPrev <= 0 && histLatest > 0;
  const priorHigh = highestClose(bars, 20, 1);
  const breakout = priorHigh != null && close > priorHigh;
  const trendUp = close > ma20 && ma5 > ma20;
  const volumeStrong = volumeRatio != null && volumeRatio >= 1.5;
  const volumeMild = volumeRatio != null && volumeRatio >= 1.2;
  const reasons = [];
  let score = 0;
  if (trendUp) {
    reasons.push("\u6536\u76D8\u4EF7\u7AD9\u4E0A MA20\uFF0C\u77ED\u671F\u5747\u7EBF\u591A\u5934");
    score += 25;
  }
  if (volumeStrong) {
    reasons.push(`\u6210\u4EA4\u91CF\u653E\u5927 ${volumeRatio}x\uFF085 \u65E5\u5747\u91CF\uFF09`);
    score += 25;
  } else if (volumeMild) {
    reasons.push(`\u6210\u4EA4\u91CF\u6E29\u548C\u653E\u5927 ${volumeRatio}x`);
    score += 12;
  }
  if (macdGoldenCross) {
    reasons.push("MACD \u91D1\u53C9");
    score += 25;
  } else if (macdHistTurningPositive) {
    reasons.push("MACD \u67F1\u7531\u8D1F\u8F6C\u6B63");
    score += 12;
  }
  if (breakout) {
    reasons.push("\u7A81\u7834\u8FD1 20 \u65E5\u9AD8\u70B9");
    score += 25;
  }
  const isRed = trendUp && volumeStrong && macdGoldenCross && breakout && score >= 75;
  const isBlue = !isRed && trendUp && volumeMild && (macdGoldenCross || macdHistTurningPositive) && score >= 45;
  if (!isRed && !isBlue) return null;
  return {
    symbol,
    name,
    tradeDate: latest.tradeDate,
    close,
    strength: isRed ? "red" : "blue",
    score,
    reasons,
    ma5,
    ma20,
    volumeRatio,
    macdGoldenCross,
    breakout
  };
}
async function scanDiamondSignal(symbol, name, klineDays = 60) {
  const data = await getDailyQuote(symbol, klineDays);
  return detectDiamondSignal(symbol, name, barsFromQuote(data.quotes));
}
function scanDiamondSignalHistory(symbol, name, bars, lookback = 120) {
  const found = [];
  const limit = Math.min(bars.length, lookback);
  for (let i = 0; i < limit; i++) {
    if (bars.length - i < 30) break;
    const slice = bars.slice(i);
    const signal = detectDiamondSignal(symbol, name, slice);
    const bar = slice[0];
    if (!signal || !bar?.tradeDate || bar.close == null) continue;
    if (signal.tradeDate.replace(/-/g, "") !== bar.tradeDate.replace(/-/g, "")) {
      continue;
    }
    const prev = found[found.length - 1];
    if (prev && prev.tradeDate === bar.tradeDate) continue;
    found.push(signal);
  }
  return found;
}

// ../../packages/agent-core/src/data/paper/momentum.ts
var MOMENTUM_STOP_LOSS_PCT = 0.08;
var MOMENTUM_MIN_CHECKLIST = 4;
function barsFromQuotes(quotes) {
  return quotes.filter((q) => q.close != null);
}
function analyzeMomentum(symbol, name, bars, diamond) {
  const filtered = barsFromQuotes(bars);
  if (filtered.length < 30) return null;
  const latest = filtered[0];
  const close = latest.close;
  const closes = filtered.map((b) => b.close).filter(Boolean);
  const ma5 = sma(closes, 5);
  const ma20 = sma(closes, 20);
  if (ma20 == null) return null;
  const volAvg5 = avgVolume(filtered, 5);
  const volumeRatio = volAvg5 && latest.vol ? Number((latest.vol / volAvg5).toFixed(2)) : null;
  const priorHigh = highestClose(filtered, 20, 1);
  const breakout = priorHigh != null && close > priorHigh;
  const trendUp = close > ma20 && ma5 != null && ma5 > ma20;
  const volumeOk = volumeRatio != null && volumeRatio >= 1.2;
  const { dif, dea } = macd([...closes].reverse());
  const difLatest = dif[dif.length - 1];
  const deaLatest = dea[dea.length - 1];
  const difPrev = dif[dif.length - 2];
  const deaPrev = dea[dea.length - 2];
  const macdGolden = difPrev <= deaPrev && difLatest > deaLatest;
  const strength = diamond?.strength ?? null;
  const checklist = [
    {
      id: "trend",
      label: "\u8D8B\u52BF\u591A\u5934\uFF08\u6536\u76D8 > MA20\uFF0CMA5 > MA20\uFF09",
      passed: trendUp,
      detail: ma5 != null ? `\u6536\u76D8 ${close.toFixed(2)} / MA20 ${ma20.toFixed(2)}` : void 0
    },
    {
      id: "volume",
      label: "\u91CF\u80FD\u914D\u5408\uFF08\u2265 1.2\xD7 5 \u65E5\u5747\u91CF\uFF09",
      passed: volumeOk,
      detail: volumeRatio != null ? `${volumeRatio}x` : void 0
    },
    {
      id: "breakout",
      label: "\u7A81\u7834\u6216\u5F3A\u52BF\u7ED3\u6784\uFF08\u8FD1 20 \u65E5\u65B0\u9AD8\uFF09",
      passed: breakout
    },
    {
      id: "macd",
      label: "MACD \u91D1\u53C9\u6216\u7EA2\u94BB\u786E\u8BA4",
      passed: macdGolden || strength === "red"
    },
    {
      id: "diamond",
      label: "\u7EA2\u94BB\u4FE1\u53F7\uFF08\u52A8\u91CF\u542F\u52A8\uFF09",
      passed: strength === "red",
      detail: strength === "blue" ? "\u5F53\u524D\u4E3A\u84DD\u94BB\uFF0C\u504F\u6E29\u548C" : void 0
    },
    {
      id: "risk",
      label: "\u6B62\u635F\u4F4D\u5DF2\u8BBE\u5B9A\uFF08\u6210\u672C -8%\uFF09",
      passed: true,
      detail: `\u5EFA\u8BAE\u6B62\u635F ${(close * (1 - MOMENTUM_STOP_LOSS_PCT)).toFixed(2)}`
    }
  ];
  const checklistScore = checklist.filter((c) => c.passed).length;
  let action = "wait";
  if (close < ma20) {
    action = "sell";
  } else if (strength === "red" && checklistScore >= MOMENTUM_MIN_CHECKLIST) {
    action = "buy";
  } else if (trendUp && (strength === "blue" || strength === "red")) {
    action = "hold";
  }
  const entryMemo = [
    `\u3010\u52A8\u91CF\u3011${name}(${symbol})`,
    trendUp ? "\u8D8B\u52BF\u5411\u4E0A" : "\u8D8B\u52BF\u5F85\u786E\u8BA4",
    strength === "red" ? "\u7EA2\u94BB\u542F\u52A8" : strength === "blue" ? "\u84DD\u94BB\u5173\u6CE8" : "\u6682\u65E0\u94BB\u77F3\u4FE1\u53F7",
    breakout ? "\u7A81\u783420\u65E5\u9AD8" : "",
    `\u6B62\u635F ${(close * (1 - MOMENTUM_STOP_LOSS_PCT)).toFixed(2)}\uFF08-8%\uFF09`
  ].filter(Boolean).join(" \xB7 ");
  return {
    close,
    ma5,
    ma20,
    trendUp,
    volumeRatio,
    breakout,
    checklist,
    checklistScore,
    action,
    stopLossPrice: Number((close * (1 - MOMENTUM_STOP_LOSS_PCT)).toFixed(2)),
    entryMemo,
    diamondStrength: strength
  };
}
function calcStopLoss(entryPrice) {
  return Number((entryPrice * (1 - MOMENTUM_STOP_LOSS_PCT)).toFixed(2));
}

// ../../packages/agent-core/src/data/watchlist/store.ts
import { createClient } from "@libsql/client";

// ../../packages/agent-core/src/data/libsql-config.ts
import { mkdirSync as mkdirSync2 } from "node:fs";
import path2 from "node:path";

// ../../packages/agent-core/src/mastra/config/paths.ts
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
var PACKAGE_NAME = "@investment-agent/agent-core";
function resolvePackageRoot() {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 12; i++) {
    const pkgPath = path.join(dir, "package.json");
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
        if (pkg.name === PACKAGE_NAME) {
          return dir;
        }
      } catch {
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}
var packageRoot = resolvePackageRoot();
var DATA_DIR = path.join(packageRoot, "src/data");
if (!existsSync(DATA_DIR)) {
  mkdirSync(DATA_DIR, { recursive: true });
}

// ../../packages/agent-core/src/data/libsql-config.ts
function vercelDataDir() {
  const dir = path2.join("/tmp", "investment-agent-data");
  mkdirSync2(dir, { recursive: true });
  return dir;
}
function fileDbUrl(filename) {
  if (process.env.VERCEL) {
    return `file:${path2.join(vercelDataDir(), filename)}`;
  }
  return `file:${path2.join(DATA_DIR, filename)}`;
}
function getPrimaryLibsqlOptions(filename = "research-reports.db") {
  const remoteUrl = process.env.LIBSQL_URL?.trim();
  if (remoteUrl) {
    const authToken = process.env.LIBSQL_AUTH_TOKEN?.trim();
    return authToken ? { url: remoteUrl, authToken } : { url: remoteUrl };
  }
  return { url: fileDbUrl(filename) };
}

// ../../packages/agent-core/src/data/watchlist/store.ts
var client = null;
var migrated = false;
async function getDb() {
  if (!client) {
    client = createClient(getPrimaryLibsqlOptions());
  }
  if (!migrated) {
    await client.batch([
      `CREATE TABLE IF NOT EXISTS watchlist_items (
        id TEXT PRIMARY KEY,
        symbol TEXT NOT NULL,
        name TEXT NOT NULL,
        reason TEXT,
        source_type TEXT,
        source_id TEXT,
        entry_price REAL,
        entry_date TEXT,
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_watchlist_symbol ON watchlist_items(symbol)`,
      `CREATE TABLE IF NOT EXISTS watchlist_snapshots (
        id TEXT PRIMARY KEY,
        watchlist_id TEXT NOT NULL,
        symbol TEXT NOT NULL,
        trade_date TEXT NOT NULL,
        close REAL NOT NULL,
        pct_chg REAL,
        vs_entry_pct REAL,
        diamond_strength TEXT,
        snapshot_at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_watchlist_snapshots_symbol ON watchlist_snapshots(symbol, trade_date)`,
      `CREATE TABLE IF NOT EXISTS diamond_signals (
        id TEXT PRIMARY KEY,
        symbol TEXT NOT NULL,
        name TEXT NOT NULL,
        strength TEXT NOT NULL,
        score INTEGER NOT NULL,
        trade_date TEXT NOT NULL,
        close REAL NOT NULL,
        reasons TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_diamond_signals_date ON diamond_signals(trade_date)`,
      `CREATE TABLE IF NOT EXISTS weekly_reviews (
        id TEXT PRIMARY KEY,
        week_start TEXT NOT NULL,
        week_end TEXT NOT NULL,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        stats TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`
    ]);
    migrated = true;
  }
  return client;
}
async function addWatchlistItem(input) {
  const db = await getDb();
  const existing = await db.execute({
    sql: `SELECT id FROM watchlist_items WHERE symbol = ? AND active = 1 LIMIT 1`,
    args: [input.symbol]
  });
  if (existing.rows.length > 0) {
    const id2 = String(existing.rows[0].id);
    await db.execute({
      sql: `UPDATE watchlist_items SET name = ?, reason = COALESCE(?, reason),
            source_type = COALESCE(?, source_type), source_id = COALESCE(?, source_id),
            entry_price = COALESCE(?, entry_price), entry_date = COALESCE(?, entry_date)
            WHERE id = ?`,
      args: [
        input.name,
        input.reason ?? null,
        input.sourceType ?? null,
        input.sourceId ?? null,
        input.entryPrice ?? null,
        input.entryDate ?? null,
        id2
      ]
    });
    const item = await getWatchlistItem(id2);
    if (!item) throw new Error("watchlist update failed");
    return item;
  }
  const count = await db.execute({
    sql: `SELECT COUNT(*) AS cnt FROM watchlist_items WHERE active = 1`
  });
  const countRow = count.rows[0];
  const total = Number(countRow?.cnt ?? 0);
  if (total >= 20) {
    throw new Error("\u76D1\u63A7\u6C60\u6700\u591A 20 \u53EA\u80A1\u7968");
  }
  const id = crypto.randomUUID();
  const createdAt = (/* @__PURE__ */ new Date()).toISOString();
  await db.execute({
    sql: `INSERT INTO watchlist_items
          (id, symbol, name, reason, source_type, source_id, entry_price, entry_date, active, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
    args: [
      id,
      input.symbol,
      input.name,
      input.reason ?? null,
      input.sourceType ?? null,
      input.sourceId ?? null,
      input.entryPrice ?? null,
      input.entryDate ?? (/* @__PURE__ */ new Date()).toISOString().slice(0, 10),
      createdAt
    ]
  });
  return {
    id,
    symbol: input.symbol,
    name: input.name,
    reason: input.reason ?? null,
    sourceType: input.sourceType ?? null,
    sourceId: input.sourceId ?? null,
    entryPrice: input.entryPrice ?? null,
    entryDate: input.entryDate ?? (/* @__PURE__ */ new Date()).toISOString().slice(0, 10),
    active: true,
    createdAt
  };
}
function mapWatchlistRow(row) {
  return {
    id: String(row.id),
    symbol: String(row.symbol),
    name: String(row.name),
    reason: row.reason == null ? null : String(row.reason),
    sourceType: row.source_type,
    sourceId: row.source_id == null ? null : String(row.source_id),
    entryPrice: row.entry_price == null ? null : Number(row.entry_price),
    entryDate: row.entry_date == null ? null : String(row.entry_date),
    active: Number(row.active) === 1,
    createdAt: String(row.created_at)
  };
}
async function listWatchlistItems() {
  const db = await getDb();
  const result = await db.execute({
    sql: `SELECT * FROM watchlist_items WHERE active = 1 ORDER BY created_at DESC`
  });
  return result.rows.map((row) => mapWatchlistRow(row));
}
async function getWatchlistItem(id) {
  const db = await getDb();
  const result = await db.execute({
    sql: `SELECT * FROM watchlist_items WHERE id = ?`,
    args: [id]
  });
  const row = result.rows[0];
  return row ? mapWatchlistRow(row) : null;
}
async function removeWatchlistItem(id) {
  const db = await getDb();
  await db.execute({
    sql: `UPDATE watchlist_items SET active = 0 WHERE id = ?`,
    args: [id]
  });
}
async function saveWatchlistSnapshot(input) {
  const db = await getDb();
  const id = crypto.randomUUID();
  await db.execute({
    sql: `INSERT INTO watchlist_snapshots
          (id, watchlist_id, symbol, trade_date, close, pct_chg, vs_entry_pct, diamond_strength, snapshot_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      id,
      input.watchlistId,
      input.symbol,
      input.tradeDate,
      input.close,
      input.pctChg,
      input.vsEntryPct,
      input.diamondStrength ?? null,
      (/* @__PURE__ */ new Date()).toISOString()
    ]
  });
}
async function listSnapshotsForSymbol(symbol, limit = 30) {
  const db = await getDb();
  const result = await db.execute({
    sql: `SELECT * FROM watchlist_snapshots WHERE symbol = ?
          ORDER BY snapshot_at DESC LIMIT ?`,
    args: [symbol, limit]
  });
  return result.rows.map((row) => {
    const r = row;
    return {
      id: String(r.id),
      watchlistId: String(r.watchlist_id),
      symbol: String(r.symbol),
      tradeDate: String(r.trade_date),
      close: Number(r.close),
      pctChg: r.pct_chg == null ? null : Number(r.pct_chg),
      vsEntryPct: r.vs_entry_pct == null ? null : Number(r.vs_entry_pct),
      diamondStrength: r.diamond_strength,
      snapshotAt: String(r.snapshot_at)
    };
  });
}
async function listLatestSnapshots() {
  const db = await getDb();
  const result = await db.execute({
    sql: `SELECT s.* FROM watchlist_snapshots s
          INNER JOIN (
            SELECT symbol, MAX(snapshot_at) AS max_at
            FROM watchlist_snapshots GROUP BY symbol
          ) latest ON s.symbol = latest.symbol AND s.snapshot_at = latest.max_at
          ORDER BY s.symbol`
  });
  return result.rows.map((row) => {
    const r = row;
    return {
      id: String(r.id),
      watchlistId: String(r.watchlist_id),
      symbol: String(r.symbol),
      tradeDate: String(r.trade_date),
      close: Number(r.close),
      pctChg: r.pct_chg == null ? null : Number(r.pct_chg),
      vsEntryPct: r.vs_entry_pct == null ? null : Number(r.vs_entry_pct),
      diamondStrength: r.diamond_strength,
      snapshotAt: String(r.snapshot_at)
    };
  });
}
async function saveDiamondSignal(input) {
  const db = await getDb();
  const id = crypto.randomUUID();
  const createdAt = (/* @__PURE__ */ new Date()).toISOString();
  await db.execute({
    sql: `INSERT INTO diamond_signals
          (id, symbol, name, strength, score, trade_date, close, reasons, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      id,
      input.symbol,
      input.name,
      input.strength,
      input.score,
      input.tradeDate,
      input.close,
      JSON.stringify(input.reasons),
      createdAt
    ]
  });
  return {
    id,
    symbol: input.symbol,
    name: input.name,
    strength: input.strength,
    score: input.score,
    tradeDate: input.tradeDate,
    close: input.close,
    reasons: input.reasons,
    createdAt
  };
}
async function listDiamondSignals(limit = 50) {
  const db = await getDb();
  const result = await db.execute({
    sql: `SELECT * FROM diamond_signals ORDER BY created_at DESC LIMIT ?`,
    args: [limit]
  });
  return result.rows.map((row) => {
    const r = row;
    const reasonsRaw = String(r.reasons ?? "[]");
    let reasons = [];
    try {
      const parsed = JSON.parse(reasonsRaw);
      reasons = Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      reasons = [];
    }
    return {
      id: String(r.id),
      symbol: String(r.symbol),
      name: String(r.name),
      strength: r.strength,
      score: Number(r.score),
      tradeDate: String(r.trade_date),
      close: Number(r.close),
      reasons,
      createdAt: String(r.created_at)
    };
  });
}
async function saveWeeklyReview(input) {
  const db = await getDb();
  const id = crypto.randomUUID();
  const createdAt = (/* @__PURE__ */ new Date()).toISOString();
  await db.execute({
    sql: `INSERT INTO weekly_reviews (id, week_start, week_end, title, content, stats, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: [
      id,
      input.weekStart,
      input.weekEnd,
      input.title,
      input.content,
      JSON.stringify(input.stats),
      createdAt
    ]
  });
  return {
    id,
    weekStart: input.weekStart,
    weekEnd: input.weekEnd,
    title: input.title,
    content: input.content,
    stats: input.stats,
    createdAt
  };
}
async function listWeeklyReviews(limit = 12) {
  const db = await getDb();
  const result = await db.execute({
    sql: `SELECT * FROM weekly_reviews ORDER BY created_at DESC LIMIT ?`,
    args: [limit]
  });
  return result.rows.map((row) => {
    const r = row;
    return {
      id: String(r.id),
      weekStart: String(r.week_start),
      weekEnd: String(r.week_end),
      title: String(r.title),
      content: String(r.content),
      stats: JSON.parse(String(r.stats)),
      createdAt: String(r.created_at)
    };
  });
}
async function getWeeklyReview(id) {
  const db = await getDb();
  const result = await db.execute({
    sql: `SELECT * FROM weekly_reviews WHERE id = ?`,
    args: [id]
  });
  const r = result.rows[0];
  if (!r) return null;
  return {
    id: String(r.id),
    weekStart: String(r.week_start),
    weekEnd: String(r.week_end),
    title: String(r.title),
    content: String(r.content),
    stats: JSON.parse(String(r.stats)),
    createdAt: String(r.created_at)
  };
}

// ../../packages/agent-core/src/data/watchlist/jobs.ts
async function runDailyWatchlistSnapshot() {
  const items = await listWatchlistItems();
  const results = [];
  for (const item of items) {
    try {
      const quote = await getDailyQuote(item.symbol, 5);
      const latest = quote.quotes[0];
      if (!latest?.close) continue;
      let diamondStrength = null;
      try {
        const signal = await scanDiamondSignal(item.symbol, item.name, 60);
        if (signal) {
          diamondStrength = signal.strength;
          await saveDiamondSignal({
            symbol: signal.symbol,
            name: signal.name,
            strength: signal.strength,
            score: signal.score,
            tradeDate: signal.tradeDate,
            close: signal.close,
            reasons: signal.reasons
          });
        }
      } catch {
      }
      const vsEntryPct = item.entryPrice && item.entryPrice > 0 ? Number(
        ((latest.close - item.entryPrice) / item.entryPrice * 100).toFixed(2)
      ) : null;
      await saveWatchlistSnapshot({
        watchlistId: item.id,
        symbol: item.symbol,
        tradeDate: latest.tradeDate,
        close: latest.close,
        pctChg: latest.pctChg,
        vsEntryPct,
        diamondStrength
      });
      results.push({
        symbol: item.symbol,
        close: latest.close,
        pctChg: latest.pctChg,
        vsEntryPct,
        diamondStrength
      });
    } catch (error) {
      results.push({
        symbol: item.symbol,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }
  return { count: items.length, results, ranAt: (/* @__PURE__ */ new Date()).toISOString() };
}
async function scanWatchlistDiamondSignals() {
  const items = await listWatchlistItems();
  const signals = [];
  for (const item of items) {
    try {
      const signal = await scanDiamondSignal(item.symbol, item.name, 60);
      if (!signal) continue;
      const saved = await saveDiamondSignal({
        symbol: signal.symbol,
        name: signal.name,
        strength: signal.strength,
        score: signal.score,
        tradeDate: signal.tradeDate,
        close: signal.close,
        reasons: signal.reasons
      });
      signals.push(saved);
    } catch {
    }
  }
  return { scanned: items.length, signals, ranAt: (/* @__PURE__ */ new Date()).toISOString() };
}
async function scanSymbolsDiamondSignals(symbols) {
  const signals = [];
  for (const item of symbols.slice(0, 30)) {
    try {
      const signal = await scanDiamondSignal(item.symbol, item.name, 60);
      if (!signal) continue;
      const saved = await saveDiamondSignal({
        symbol: signal.symbol,
        name: signal.name,
        strength: signal.strength,
        score: signal.score,
        tradeDate: signal.tradeDate,
        close: signal.close,
        reasons: signal.reasons
      });
      signals.push(saved);
    } catch {
    }
  }
  return signals;
}

// ../../packages/agent-core/src/data/paper/store.ts
import { createClient as createClient2 } from "@libsql/client";
init_trading_calendar();
var DEFAULT_CASH = 5e4;
var client2 = null;
var migrated2 = false;
async function getDb2() {
  if (!client2) {
    client2 = createClient2(getPrimaryLibsqlOptions());
  }
  if (!migrated2) {
    await client2.batch([
      `CREATE TABLE IF NOT EXISTS paper_accounts (
        id TEXT PRIMARY KEY,
        cash REAL NOT NULL,
        initial_cash REAL NOT NULL,
        created_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS paper_trades (
        id TEXT PRIMARY KEY,
        symbol TEXT NOT NULL,
        name TEXT NOT NULL,
        side TEXT NOT NULL,
        shares INTEGER NOT NULL,
        price REAL NOT NULL,
        amount REAL NOT NULL,
        traded_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS paper_positions (
        symbol TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        shares INTEGER NOT NULL,
        avg_cost REAL NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS paper_lots (
        id TEXT PRIMARY KEY,
        symbol TEXT NOT NULL,
        shares INTEGER NOT NULL,
        remaining_shares INTEGER NOT NULL,
        buy_price REAL NOT NULL,
        buy_date TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS paper_equity_snapshots (
        id TEXT PRIMARY KEY,
        trade_date TEXT NOT NULL UNIQUE,
        total_value REAL NOT NULL,
        cash REAL NOT NULL,
        market_value REAL NOT NULL,
        return_pct REAL NOT NULL,
        created_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS paper_auto_runs (
        id TEXT PRIMARY KEY,
        trade_date TEXT NOT NULL,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        status TEXT NOT NULL,
        summary_json TEXT
      )`,
      `CREATE TABLE IF NOT EXISTS paper_position_meta (
        symbol TEXT PRIMARY KEY,
        stop_loss REAL NOT NULL,
        high_water_mark REAL NOT NULL,
        entry_memo TEXT,
        entry_date TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`
    ]);
    for (const sql of [
      `ALTER TABLE paper_trades ADD COLUMN trade_date TEXT`,
      `ALTER TABLE paper_trades ADD COLUMN source TEXT DEFAULT 'manual'`,
      `ALTER TABLE paper_trades ADD COLUMN note TEXT`
    ]) {
      try {
        await client2.execute(sql);
      } catch {
      }
    }
    await backfillLotsFromTrades(client2);
    await backfillPositionMeta(client2);
    migrated2 = true;
  }
  return client2;
}
async function backfillLotsFromTrades(db) {
  const lots = await db.execute(`SELECT COUNT(*) AS c FROM paper_lots`);
  if (Number(lots.rows[0].c) > 0) return;
  const buys = await db.execute({
    sql: `SELECT * FROM paper_trades WHERE side = 'buy' ORDER BY traded_at ASC`
  });
  for (const row of buys.rows) {
    const r = row;
    const tradeDate = r.trade_date != null ? String(r.trade_date) : formatTradeDate(new Date(String(r.traded_at)));
    await db.execute({
      sql: `INSERT INTO paper_lots (id, symbol, shares, remaining_shares, buy_price, buy_date, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [
        crypto.randomUUID(),
        String(r.symbol),
        Number(r.shares),
        Number(r.shares),
        Number(r.price),
        tradeDate,
        String(r.traded_at)
      ]
    });
  }
  const sells = await db.execute({
    sql: `SELECT * FROM paper_trades WHERE side = 'sell' ORDER BY traded_at ASC`
  });
  for (const row of sells.rows) {
    const r = row;
    let remaining = Number(r.shares);
    const symbol = String(r.symbol);
    const lotRows = await db.execute({
      sql: `SELECT * FROM paper_lots WHERE symbol = ? AND remaining_shares > 0 ORDER BY buy_date ASC, created_at ASC`,
      args: [symbol]
    });
    for (const lotRow of lotRows.rows) {
      if (remaining <= 0) break;
      const lot = lotRow;
      const lotRemaining = Number(lot.remaining_shares);
      const deduct = Math.min(lotRemaining, remaining);
      await db.execute({
        sql: `UPDATE paper_lots SET remaining_shares = ? WHERE id = ?`,
        args: [lotRemaining - deduct, String(lot.id)]
      });
      remaining -= deduct;
    }
  }
}
async function backfillPositionMeta(db) {
  const positions = await db.execute(`SELECT * FROM paper_positions`);
  for (const row of positions.rows) {
    const r = row;
    const symbol = String(r.symbol);
    const exists = await db.execute({
      sql: `SELECT 1 FROM paper_position_meta WHERE symbol = ? LIMIT 1`,
      args: [symbol]
    });
    if (exists.rows.length > 0) continue;
    const avgCost = Number(r.avg_cost);
    await db.execute({
      sql: `INSERT INTO paper_position_meta (symbol, stop_loss, high_water_mark, entry_memo, entry_date, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)`,
      args: [
        symbol,
        calcStopLoss(avgCost),
        avgCost,
        null,
        formatTradeDate(),
        (/* @__PURE__ */ new Date()).toISOString()
      ]
    });
  }
}
async function getOrCreatePaperAccount() {
  const db = await getDb2();
  const result = await db.execute({
    sql: `SELECT * FROM paper_accounts ORDER BY created_at ASC LIMIT 1`
  });
  if (result.rows.length > 0) {
    const r = result.rows[0];
    return {
      id: String(r.id),
      cash: Number(r.cash),
      initialCash: Number(r.initial_cash),
      createdAt: String(r.created_at)
    };
  }
  const id = crypto.randomUUID();
  const createdAt = (/* @__PURE__ */ new Date()).toISOString();
  await db.execute({
    sql: `INSERT INTO paper_accounts (id, cash, initial_cash, created_at) VALUES (?, ?, ?, ?)`,
    args: [id, DEFAULT_CASH, DEFAULT_CASH, createdAt]
  });
  return { id, cash: DEFAULT_CASH, initialCash: DEFAULT_CASH, createdAt };
}
async function listPaperPositions() {
  const db = await getDb2();
  const result = await db.execute({
    sql: `SELECT * FROM paper_positions ORDER BY symbol`
  });
  return result.rows.map((row) => {
    const r = row;
    return {
      symbol: String(r.symbol),
      name: String(r.name),
      shares: Number(r.shares),
      avgCost: Number(r.avg_cost)
    };
  });
}
function mapTradeRow(r) {
  return {
    id: String(r.id),
    symbol: String(r.symbol),
    name: String(r.name),
    side: r.side,
    shares: Number(r.shares),
    price: Number(r.price),
    amount: Number(r.amount),
    tradeDate: r.trade_date != null ? String(r.trade_date) : formatTradeDate(new Date(String(r.traded_at))),
    tradedAt: String(r.traded_at),
    source: r.source ?? "manual",
    note: r.note != null ? String(r.note) : null
  };
}
async function listPaperTrades(limit = 50) {
  const db = await getDb2();
  const result = await db.execute({
    sql: `SELECT * FROM paper_trades ORDER BY traded_at DESC LIMIT ?`,
    args: [limit]
  });
  return result.rows.map((row) => mapTradeRow(row));
}

// ../../packages/agent-core/src/data/watchlist/weekly-review.ts
function weekRange(date = /* @__PURE__ */ new Date()) {
  const end = new Date(date);
  const start = new Date(date);
  start.setDate(end.getDate() - 6);
  const fmt = (d) => d.toISOString().slice(0, 10);
  return { weekStart: fmt(start), weekEnd: fmt(end) };
}
async function generateWeeklyReview() {
  const { weekStart, weekEnd } = weekRange();
  const items = await listWatchlistItems();
  const snapshots = await listLatestSnapshots();
  const diamonds = await listDiamondSignals(20);
  const account = await getOrCreatePaperAccount();
  const positions = await listPaperPositions();
  const trades = await listPaperTrades(20);
  const snapshotMap = new Map(snapshots.map((s) => [s.symbol, s]));
  const returns = items.map((item) => {
    const snap = snapshotMap.get(item.symbol);
    return snap?.vsEntryPct ?? snap?.pctChg ?? null;
  }).filter((v) => v != null);
  const avgReturnPct = returns.length > 0 ? Number((returns.reduce((a, b) => a + b, 0) / returns.length).toFixed(2)) : null;
  let bestSymbol = null;
  let worstSymbol = null;
  let bestRet = Number.NEGATIVE_INFINITY;
  let worstRet = Number.POSITIVE_INFINITY;
  for (const item of items) {
    const snap = snapshotMap.get(item.symbol);
    const ret = snap?.vsEntryPct ?? snap?.pctChg;
    if (ret == null) continue;
    if (ret > bestRet) {
      bestRet = ret;
      bestSymbol = item.symbol;
    }
    if (ret < worstRet) {
      worstRet = ret;
      worstSymbol = item.symbol;
    }
  }
  const diamondRedCount = diamonds.filter((d) => d.strength === "red").length;
  const diamondBlueCount = diamonds.filter((d) => d.strength === "blue").length;
  let paperValue = account.cash;
  for (const pos of positions) {
    try {
      const q = await getDailyQuote(pos.symbol, 2);
      const price = q.latestClose ?? pos.avgCost;
      paperValue += pos.shares * price;
    } catch {
      paperValue += pos.shares * pos.avgCost;
    }
  }
  const paperReturnPct = Number(
    ((paperValue - account.initialCash) / account.initialCash * 100).toFixed(2)
  );
  const lines = [
    `# \u672C\u5468\u76D1\u63A7\u590D\u76D8\uFF08${weekStart} ~ ${weekEnd}\uFF09`,
    "",
    "## \u76D1\u63A7\u6C60\u6982\u89C8",
    `- \u5728\u76D1\u63A7 **${items.length}** \u53EA`,
    avgReturnPct != null ? `- \u76F8\u5BF9\u52A0\u5165\u4EF7\u5E73\u5747\u6DA8\u8DCC **${avgReturnPct > 0 ? "+" : ""}${avgReturnPct}%**` : "- \u6682\u65E0\u8DB3\u591F\u5FEB\u7167\u8BA1\u7B97\u5E73\u5747\u6DA8\u8DCC",
    bestSymbol != null ? `- \u8868\u73B0\u6700\u597D\uFF1A**${bestSymbol}**\uFF08${bestRet > 0 ? "+" : ""}${bestRet.toFixed(2)}%\uFF09` : "",
    worstSymbol != null ? `- \u8868\u73B0\u6700\u5F31\uFF1A**${worstSymbol}**\uFF08${worstRet > 0 ? "+" : ""}${worstRet.toFixed(2)}%\uFF09` : "",
    "",
    "## \u94BB\u77F3\u4FE1\u53F7",
    `- \u8FD1\u671F\u7EA2\u94BB ${diamondRedCount} \u6B21 \xB7 \u84DD\u94BB ${diamondBlueCount} \u6B21`,
    diamonds.length > 0 ? diamonds.slice(0, 5).map(
      (d) => `- ${d.strength === "red" ? "\u{1F534}" : "\u{1F535}"} ${d.name}\uFF08${d.symbol}\uFF09${d.tradeDate} \xB7 ${d.reasons[0] ?? ""}`
    ).join("\n") : "- \u672C\u5468\u6682\u65E0\u65B0\u4FE1\u53F7",
    "",
    "## \u6A21\u62DF\u8D26\u6237",
    `- \u603B\u8D44\u4EA7\u7EA6 **${paperValue.toFixed(0)}** \u5143\uFF08\u521D\u59CB ${account.initialCash.toFixed(0)}\uFF09`,
    `- \u7D2F\u8BA1\u6536\u76CA\u7387 **${paperReturnPct > 0 ? "+" : ""}${paperReturnPct}%**`,
    `- \u6301\u4ED3 ${positions.length} \u53EA \xB7 \u672C\u5468\u6210\u4EA4 ${trades.length} \u7B14`,
    "",
    "## \u9010\u53EA\u5FEB\u7167"
  ];
  for (const item of items) {
    const snap = snapshotMap.get(item.symbol);
    if (!snap) {
      lines.push(`- **${item.name}**\uFF08${item.symbol}\uFF09\uFF1A\u6682\u65E0\u6700\u65B0\u5FEB\u7167`);
      continue;
    }
    const ret = snap.vsEntryPct ?? snap.pctChg;
    const diamond = snap.diamondStrength === "red" ? " \u{1F534}\u7EA2\u94BB" : snap.diamondStrength === "blue" ? " \u{1F535}\u84DD\u94BB" : "";
    lines.push(
      `- **${item.name}**\uFF08${item.symbol}\uFF09\u6536\u76D8 ${snap.close.toFixed(2)}\uFF0C${ret != null ? `${ret > 0 ? "+" : ""}${ret}%` : "\u2014"}${diamond}`
    );
    if (item.reason) {
      lines.push(`  - \u5173\u6CE8\u7406\u7531\uFF1A${item.reason.slice(0, 80)}`);
    }
  }
  lines.push(
    "",
    "## \u514D\u8D23\u58F0\u660E",
    "\u4EE5\u4E0A\u5185\u5BB9\u57FA\u4E8E\u516C\u5F00\u884C\u60C5\u4E0E\u89C4\u5219\u5316\u4FE1\u53F7\u81EA\u52A8\u751F\u6210\uFF0C\u4EC5\u4F9B\u5B66\u4E60\u7814\u7A76\uFF0C\u4E0D\u6784\u6210\u6295\u8D44\u5EFA\u8BAE\u3002"
  );
  const content = lines.filter(Boolean).join("\n");
  const stats = {
    watchlistCount: items.length,
    avgReturnPct,
    bestSymbol,
    worstSymbol,
    diamondRedCount,
    diamondBlueCount
  };
  return saveWeeklyReview({
    weekStart,
    weekEnd,
    title: `\u76D1\u63A7\u5468\u62A5 ${weekStart}`,
    content,
    stats
  });
}

// ../../packages/agent-core/src/data/screening/store.ts
import { createClient as createClient3 } from "@libsql/client";
var client3 = null;
var migrated3 = false;
async function getDb3() {
  if (!client3) {
    client3 = createClient3(getPrimaryLibsqlOptions());
  }
  if (!migrated3) {
    await client3.batch([
      `CREATE TABLE IF NOT EXISTS screening_sessions (
        id TEXT PRIMARY KEY,
        query TEXT NOT NULL,
        sectors TEXT NOT NULL,
        candidates TEXT NOT NULL,
        rotation_summary TEXT NOT NULL,
        hot_news TEXT NOT NULL DEFAULT '[]',
        hot_themes TEXT NOT NULL DEFAULT '[]',
        mode TEXT NOT NULL DEFAULT 'auto',
        passed INTEGER NOT NULL DEFAULT 0,
        elapsed_ms INTEGER,
        created_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS committee_sessions (
        id TEXT PRIMARY KEY,
        screening_session_id TEXT,
        candidates TEXT NOT NULL,
        memo TEXT NOT NULL,
        passed INTEGER NOT NULL DEFAULT 0,
        elapsed_ms INTEGER,
        created_at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_screening_sessions_created_at
        ON screening_sessions(created_at DESC)`
    ]);
    await ensureScreeningSessionColumns(client3);
    await ensureCommitteeSessionColumns(client3);
    migrated3 = true;
  }
  return client3;
}
async function ensureScreeningSessionColumns(db) {
  const alters = [
    `ALTER TABLE screening_sessions ADD COLUMN hot_news TEXT NOT NULL DEFAULT '[]'`,
    `ALTER TABLE screening_sessions ADD COLUMN hot_themes TEXT NOT NULL DEFAULT '[]'`,
    `ALTER TABLE screening_sessions ADD COLUMN mode TEXT NOT NULL DEFAULT 'auto'`
  ];
  for (const sql of alters) {
    try {
      await db.execute(sql);
    } catch {
    }
  }
}
async function ensureCommitteeSessionColumns(db) {
  const alters = [
    `ALTER TABLE committee_sessions ADD COLUMN trade_plans TEXT NOT NULL DEFAULT '[]'`
  ];
  for (const sql of alters) {
    try {
      await db.execute(sql);
    } catch {
    }
  }
}
function mapScreeningRow(row) {
  return {
    id: String(row.id),
    query: String(row.query),
    sectors: JSON.parse(String(row.sectors)),
    candidates: JSON.parse(
      String(row.candidates)
    ),
    rotationSummary: String(row.rotation_summary),
    hotNews: JSON.parse(String(row.hot_news ?? "[]")),
    hotThemes: JSON.parse(String(row.hot_themes ?? "[]")),
    mode: row.mode === "manual" ? "manual" : "auto",
    passed: Boolean(row.passed),
    elapsedMs: row.elapsed_ms == null ? null : Number(row.elapsed_ms),
    createdAt: String(row.created_at)
  };
}
function mapScreeningSummary(row) {
  const sectors = JSON.parse(String(row.sectors));
  const candidates = JSON.parse(
    String(row.candidates)
  );
  return {
    id: String(row.id),
    query: String(row.query),
    hotThemes: JSON.parse(String(row.hot_themes ?? "[]")),
    mode: row.mode === "manual" ? "manual" : "auto",
    passed: Boolean(row.passed),
    elapsedMs: row.elapsed_ms == null ? null : Number(row.elapsed_ms),
    createdAt: String(row.created_at),
    sectorCount: sectors.length,
    candidateCount: candidates.length
  };
}
async function getScreeningSession(id) {
  const db = await getDb3();
  const result = await db.execute({
    sql: `SELECT * FROM screening_sessions WHERE id = ?`,
    args: [id]
  });
  if (result.rows.length === 0) return null;
  return mapScreeningRow(result.rows[0]);
}
async function listScreeningSessions(options = {}) {
  const db = await getDb3();
  const limit = options.limit ?? 50;
  const result = await db.execute({
    sql: `SELECT id, query, sectors, candidates, hot_themes, mode, passed, elapsed_ms, created_at
          FROM screening_sessions
          ORDER BY created_at DESC
          LIMIT ?`,
    args: [limit]
  });
  return result.rows.map(
    (row) => mapScreeningSummary(row)
  );
}

// ../../packages/agent-core/src/cli/watchlist-json.ts
async function main() {
  const command = process.argv[2];
  if (command === "list") {
    const items = await listWatchlistItems();
    const snapshots = await listLatestSnapshots();
    const snapMap = Object.fromEntries(snapshots.map((s) => [s.symbol, s]));
    process.stdout.write(
      JSON.stringify(items.map((i) => ({ ...i, latest: snapMap[i.symbol] ?? null })))
    );
    return;
  }
  if (command === "add") {
    const symbol = process.argv[3];
    const name = process.argv[4];
    const reason = process.argv[5];
    if (!symbol || !name) {
      process.stderr.write("Usage: watchlist-json.ts add <symbol> <name> [reason]");
      process.exit(1);
    }
    const quote = await getDailyQuote(symbol, 2).catch(() => null);
    const item = await addWatchlistItem({
      symbol,
      name,
      reason,
      entryPrice: quote?.latestClose ?? void 0,
      sourceType: "manual"
    });
    process.stdout.write(JSON.stringify(item));
    return;
  }
  if (command === "remove" && process.argv[3]) {
    await removeWatchlistItem(process.argv[3]);
    process.stdout.write(JSON.stringify({ ok: true }));
    return;
  }
  if (command === "get" && process.argv[3]) {
    const item = await getWatchlistItem(process.argv[3]);
    if (!item) {
      process.stderr.write("Not found");
      process.exit(1);
    }
    const kline = await getDailyQuote(item.symbol, 120);
    const bars = kline.quotes.filter((q) => q.close != null);
    const snapshots = await listSnapshotsForSymbol(item.symbol, 30);
    let liveSignal = null;
    try {
      liveSignal = detectDiamondSignal(item.symbol, item.name, bars);
    } catch {
      liveSignal = null;
    }
    const diamondHistory = scanDiamondSignalHistory(item.symbol, item.name, bars, 120);
    const momentum = analyzeMomentum(item.symbol, item.name, bars, liveSignal);
    process.stdout.write(
      JSON.stringify({ item, kline, snapshots, diamondSignal: liveSignal, diamondHistory, momentum })
    );
    return;
  }
  if (command === "kline" && process.argv[3]) {
    const days = Number(process.argv[4] ?? 120);
    const kline = await getDailyQuote(process.argv[3], days);
    let diamondSignal = null;
    try {
      diamondSignal = detectDiamondSignal(
        process.argv[3],
        process.argv[3],
        kline.quotes
      );
    } catch {
      diamondSignal = null;
    }
    process.stdout.write(JSON.stringify({ ...kline, diamondSignal }));
    return;
  }
  if (command === "stock-chart" && process.argv[3]) {
    const symbol = process.argv[3];
    const days = Number(process.argv[4] ?? 120);
    const basic = await getStockBasic(symbol);
    const kline = await getDailyQuote(symbol, days);
    const bars = kline.quotes.filter((q) => q.close != null);
    const diamondHistory = scanDiamondSignalHistory(basic.symbol, basic.name, bars, days);
    let latestDiamond = null;
    try {
      latestDiamond = detectDiamondSignal(basic.symbol, basic.name, bars);
    } catch {
      latestDiamond = null;
    }
    const momentum = analyzeMomentum(basic.symbol, basic.name, bars, latestDiamond);
    process.stdout.write(
      JSON.stringify({
        symbol: basic.symbol,
        name: basic.name,
        kline,
        diamondHistory,
        latestDiamond,
        momentum
      })
    );
    return;
  }
  if (command === "snapshot-daily") {
    const result = await runDailyWatchlistSnapshot();
    process.stdout.write(JSON.stringify(result));
    return;
  }
  if (command === "diamond-scan") {
    const mode = process.argv[3] ?? "watchlist";
    if (mode === "watchlist") {
      const result = await scanWatchlistDiamondSignals();
      process.stdout.write(JSON.stringify(result));
      return;
    }
    if (mode === "latest-screening") {
      const sessions = await listScreeningSessions({ limit: 1 });
      const sessionId = sessions[0]?.id;
      const full = sessionId ? await getScreeningSession(sessionId) : null;
      const symbols = (full?.candidates ?? []).map((c) => ({
        symbol: c.symbol,
        name: c.name
      }));
      const signals = await scanSymbolsDiamondSignals(symbols);
      process.stdout.write(JSON.stringify({ scanned: symbols.length, signals }));
      return;
    }
    process.stderr.write("Usage: diamond-scan watchlist|latest-screening");
    process.exit(1);
  }
  if (command === "diamond-list") {
    const signals = await listDiamondSignals(Number(process.argv[3] ?? 50));
    process.stdout.write(JSON.stringify({ signals }));
    return;
  }
  if (command === "weekly-generate") {
    const review = await generateWeeklyReview();
    process.stdout.write(JSON.stringify(review));
    return;
  }
  if (command === "weekly-list") {
    process.stdout.write(JSON.stringify(await listWeeklyReviews()));
    return;
  }
  if (command === "weekly-get" && process.argv[3]) {
    const review = await getWeeklyReview(process.argv[3]);
    if (!review) {
      process.stderr.write("Not found");
      process.exit(1);
    }
    process.stdout.write(JSON.stringify(review));
    return;
  }
  if (command === "today-summary") {
    const items = await listWatchlistItems();
    const snapshots = await listLatestSnapshots();
    process.stdout.write(JSON.stringify({ items, snapshots, date: (/* @__PURE__ */ new Date()).toISOString().slice(0, 10) }));
    return;
  }
  process.stderr.write(
    "Usage: watchlist-json.ts list|add|remove|get|kline|stock-chart|snapshot-daily|diamond-scan|diamond-list|weekly-generate|weekly-list|weekly-get|today-summary"
  );
  process.exit(1);
}
main().catch((error) => {
  process.stderr.write(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
