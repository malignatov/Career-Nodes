"use strict";
(() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __esm = (fn, res, err) => function __init() {
    if (err) throw err[0];
    try {
      return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
    } catch (e) {
      throw err = [e], e;
    }
  };
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };

  // node_modules/@capacitor/core/dist/index.js
  var ExceptionCode, CapacitorException, getPlatformId, createCapacitor, initCapacitorGlobal, Capacitor, registerPlugin, WebPlugin, encode, decode, CapacitorCookiesPluginWeb, CapacitorCookies, readBlobAsBase64, normalizeHttpHeaders, buildUrlParams, buildRequestInit, CapacitorHttpPluginWeb, CapacitorHttp, SystemBarsStyle, SystemBarType, SystemBarsPluginWeb, SystemBars;
  var init_dist = __esm({
    "node_modules/@capacitor/core/dist/index.js"() {
      (function(ExceptionCode2) {
        ExceptionCode2["Unimplemented"] = "UNIMPLEMENTED";
        ExceptionCode2["Unavailable"] = "UNAVAILABLE";
      })(ExceptionCode || (ExceptionCode = {}));
      CapacitorException = class extends Error {
        constructor(message, code, data) {
          super(message);
          this.message = message;
          this.code = code;
          this.data = data;
        }
      };
      getPlatformId = (win) => {
        var _a, _b;
        if (win === null || win === void 0 ? void 0 : win.androidBridge) {
          return "android";
        } else if ((_b = (_a = win === null || win === void 0 ? void 0 : win.webkit) === null || _a === void 0 ? void 0 : _a.messageHandlers) === null || _b === void 0 ? void 0 : _b.bridge) {
          return "ios";
        } else {
          return "web";
        }
      };
      createCapacitor = (win) => {
        const capCustomPlatform = win.CapacitorCustomPlatform || null;
        const cap = win.Capacitor || {};
        const Plugins = cap.Plugins = cap.Plugins || {};
        const getPlatform = () => {
          return capCustomPlatform !== null ? capCustomPlatform.name : getPlatformId(win);
        };
        const isNativePlatform = () => getPlatform() !== "web";
        const isPluginAvailable = (pluginName) => {
          const plugin = registeredPlugins.get(pluginName);
          if (plugin === null || plugin === void 0 ? void 0 : plugin.platforms.has(getPlatform())) {
            return true;
          }
          if (getPluginHeader(pluginName)) {
            return true;
          }
          return false;
        };
        const getPluginHeader = (pluginName) => {
          var _a;
          return (_a = cap.PluginHeaders) === null || _a === void 0 ? void 0 : _a.find((h) => h.name === pluginName);
        };
        const handleError = (err) => win.console.error(err);
        const registeredPlugins = /* @__PURE__ */ new Map();
        const registerPlugin2 = (pluginName, jsImplementations = {}) => {
          const registeredPlugin = registeredPlugins.get(pluginName);
          if (registeredPlugin) {
            console.warn(`Capacitor plugin "${pluginName}" already registered. Cannot register plugins twice.`);
            return registeredPlugin.proxy;
          }
          const platform = getPlatform();
          const pluginHeader = getPluginHeader(pluginName);
          let jsImplementation;
          const loadPluginImplementation = async () => {
            if (!jsImplementation && platform in jsImplementations) {
              jsImplementation = typeof jsImplementations[platform] === "function" ? jsImplementation = await jsImplementations[platform]() : jsImplementation = jsImplementations[platform];
            } else if (capCustomPlatform !== null && !jsImplementation && "web" in jsImplementations) {
              jsImplementation = typeof jsImplementations["web"] === "function" ? jsImplementation = await jsImplementations["web"]() : jsImplementation = jsImplementations["web"];
            }
            return jsImplementation;
          };
          const createPluginMethod = (impl, prop) => {
            var _a, _b;
            if (pluginHeader) {
              const methodHeader = pluginHeader === null || pluginHeader === void 0 ? void 0 : pluginHeader.methods.find((m) => prop === m.name);
              if (methodHeader) {
                if (methodHeader.rtype === "promise") {
                  return (options) => cap.nativePromise(pluginName, prop.toString(), options);
                } else {
                  return (options, callback) => cap.nativeCallback(pluginName, prop.toString(), options, callback);
                }
              } else if (impl) {
                return (_a = impl[prop]) === null || _a === void 0 ? void 0 : _a.bind(impl);
              }
            } else if (impl) {
              return (_b = impl[prop]) === null || _b === void 0 ? void 0 : _b.bind(impl);
            } else {
              throw new CapacitorException(`"${pluginName}" plugin is not implemented on ${platform}`, ExceptionCode.Unimplemented);
            }
          };
          const createPluginMethodWrapper = (prop) => {
            let remove;
            const wrapper = (...args) => {
              const p = loadPluginImplementation().then((impl) => {
                const fn = createPluginMethod(impl, prop);
                if (fn) {
                  const p2 = fn(...args);
                  remove = p2 === null || p2 === void 0 ? void 0 : p2.remove;
                  return p2;
                } else {
                  throw new CapacitorException(`"${pluginName}.${prop}()" is not implemented on ${platform}`, ExceptionCode.Unimplemented);
                }
              });
              if (prop === "addListener") {
                p.remove = async () => remove();
              }
              return p;
            };
            wrapper.toString = () => `${prop.toString()}() { [capacitor code] }`;
            Object.defineProperty(wrapper, "name", {
              value: prop,
              writable: false,
              configurable: false
            });
            return wrapper;
          };
          const addListener = createPluginMethodWrapper("addListener");
          const removeListener = createPluginMethodWrapper("removeListener");
          const addListenerNative = (eventName, callback) => {
            const call = addListener({ eventName }, callback);
            const remove = async () => {
              const callbackId = await call;
              removeListener({
                eventName,
                callbackId
              }, callback);
            };
            const p = new Promise((resolve2) => call.then(() => resolve2({ remove })));
            p.remove = async () => {
              console.warn(`Using addListener() without 'await' is deprecated.`);
              await remove();
            };
            return p;
          };
          const proxy = new Proxy({}, {
            get(_, prop) {
              switch (prop) {
                // https://github.com/facebook/react/issues/20030
                case "$$typeof":
                  return void 0;
                case "toJSON":
                  return () => ({});
                case "addListener":
                  return pluginHeader ? addListenerNative : addListener;
                case "removeListener":
                  return removeListener;
                default:
                  return createPluginMethodWrapper(prop);
              }
            }
          });
          Plugins[pluginName] = proxy;
          registeredPlugins.set(pluginName, {
            name: pluginName,
            proxy,
            platforms: /* @__PURE__ */ new Set([...Object.keys(jsImplementations), ...pluginHeader ? [platform] : []])
          });
          return proxy;
        };
        if (!cap.convertFileSrc) {
          cap.convertFileSrc = (filePath) => filePath;
        }
        cap.getPlatform = getPlatform;
        cap.handleError = handleError;
        cap.isNativePlatform = isNativePlatform;
        cap.isPluginAvailable = isPluginAvailable;
        cap.registerPlugin = registerPlugin2;
        cap.Exception = CapacitorException;
        cap.DEBUG = !!cap.DEBUG;
        cap.isLoggingEnabled = !!cap.isLoggingEnabled;
        return cap;
      };
      initCapacitorGlobal = (win) => win.Capacitor = createCapacitor(win);
      Capacitor = /* @__PURE__ */ initCapacitorGlobal(typeof globalThis !== "undefined" ? globalThis : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : typeof global !== "undefined" ? global : {});
      registerPlugin = Capacitor.registerPlugin;
      WebPlugin = class {
        constructor() {
          this.listeners = {};
          this.retainedEventArguments = {};
          this.windowListeners = {};
        }
        addListener(eventName, listenerFunc) {
          let firstListener = false;
          const listeners = this.listeners[eventName];
          if (!listeners) {
            this.listeners[eventName] = [];
            firstListener = true;
          }
          this.listeners[eventName].push(listenerFunc);
          const windowListener = this.windowListeners[eventName];
          if (windowListener && !windowListener.registered) {
            this.addWindowListener(windowListener);
          }
          if (firstListener) {
            this.sendRetainedArgumentsForEvent(eventName);
          }
          const remove = async () => this.removeListener(eventName, listenerFunc);
          const p = Promise.resolve({ remove });
          return p;
        }
        async removeAllListeners() {
          this.listeners = {};
          for (const listener in this.windowListeners) {
            this.removeWindowListener(this.windowListeners[listener]);
          }
          this.windowListeners = {};
        }
        notifyListeners(eventName, data, retainUntilConsumed) {
          const listeners = this.listeners[eventName];
          if (!listeners) {
            if (retainUntilConsumed) {
              let args = this.retainedEventArguments[eventName];
              if (!args) {
                args = [];
              }
              args.push(data);
              this.retainedEventArguments[eventName] = args;
            }
            return;
          }
          listeners.forEach((listener) => listener(data));
        }
        hasListeners(eventName) {
          var _a;
          return !!((_a = this.listeners[eventName]) === null || _a === void 0 ? void 0 : _a.length);
        }
        registerWindowListener(windowEventName, pluginEventName) {
          this.windowListeners[pluginEventName] = {
            registered: false,
            windowEventName,
            pluginEventName,
            handler: (event) => {
              this.notifyListeners(pluginEventName, event);
            }
          };
        }
        unimplemented(msg = "not implemented") {
          return new Capacitor.Exception(msg, ExceptionCode.Unimplemented);
        }
        unavailable(msg = "not available") {
          return new Capacitor.Exception(msg, ExceptionCode.Unavailable);
        }
        async removeListener(eventName, listenerFunc) {
          const listeners = this.listeners[eventName];
          if (!listeners) {
            return;
          }
          const index = listeners.indexOf(listenerFunc);
          this.listeners[eventName].splice(index, 1);
          if (!this.listeners[eventName].length) {
            this.removeWindowListener(this.windowListeners[eventName]);
          }
        }
        addWindowListener(handle) {
          window.addEventListener(handle.windowEventName, handle.handler);
          handle.registered = true;
        }
        removeWindowListener(handle) {
          if (!handle) {
            return;
          }
          window.removeEventListener(handle.windowEventName, handle.handler);
          handle.registered = false;
        }
        sendRetainedArgumentsForEvent(eventName) {
          const args = this.retainedEventArguments[eventName];
          if (!args) {
            return;
          }
          delete this.retainedEventArguments[eventName];
          args.forEach((arg) => {
            this.notifyListeners(eventName, arg);
          });
        }
      };
      encode = (str) => encodeURIComponent(str).replace(/%(2[346B]|5E|60|7C)/g, decodeURIComponent).replace(/[()]/g, escape);
      decode = (str) => str.replace(/(%[\dA-F]{2})+/gi, decodeURIComponent);
      CapacitorCookiesPluginWeb = class extends WebPlugin {
        async getCookies() {
          const cookies = document.cookie;
          const cookieMap = {};
          cookies.split(";").forEach((cookie) => {
            if (cookie.length <= 0)
              return;
            let [key, value] = cookie.replace(/=/, "CAP_COOKIE").split("CAP_COOKIE");
            key = decode(key).trim();
            value = decode(value).trim();
            cookieMap[key] = value;
          });
          return cookieMap;
        }
        async setCookie(options) {
          try {
            const encodedKey = encode(options.key);
            const encodedValue = encode(options.value);
            const expires = options.expires ? `; expires=${options.expires.replace("expires=", "")}` : "";
            const path = (options.path || "/").replace("path=", "");
            const domain = options.url != null && options.url.length > 0 ? `domain=${options.url}` : "";
            document.cookie = `${encodedKey}=${encodedValue || ""}${expires}; path=${path}; ${domain};`;
          } catch (error) {
            return Promise.reject(error);
          }
        }
        async deleteCookie(options) {
          try {
            document.cookie = `${options.key}=; Max-Age=0`;
          } catch (error) {
            return Promise.reject(error);
          }
        }
        async clearCookies() {
          try {
            const cookies = document.cookie.split(";") || [];
            for (const cookie of cookies) {
              document.cookie = cookie.replace(/^ +/, "").replace(/=.*/, `=;expires=${(/* @__PURE__ */ new Date()).toUTCString()};path=/`);
            }
          } catch (error) {
            return Promise.reject(error);
          }
        }
        async clearAllCookies() {
          try {
            await this.clearCookies();
          } catch (error) {
            return Promise.reject(error);
          }
        }
      };
      CapacitorCookies = registerPlugin("CapacitorCookies", {
        web: () => new CapacitorCookiesPluginWeb()
      });
      readBlobAsBase64 = async (blob) => new Promise((resolve2, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const base64String = reader.result;
          resolve2(base64String.indexOf(",") >= 0 ? base64String.split(",")[1] : base64String);
        };
        reader.onerror = (error) => reject(error);
        reader.readAsDataURL(blob);
      });
      normalizeHttpHeaders = (headers = {}) => {
        const originalKeys = Object.keys(headers);
        const loweredKeys = Object.keys(headers).map((k) => k.toLocaleLowerCase());
        const normalized = loweredKeys.reduce((acc, key, index) => {
          acc[key] = headers[originalKeys[index]];
          return acc;
        }, {});
        return normalized;
      };
      buildUrlParams = (params, shouldEncode = true) => {
        if (!params)
          return null;
        const output = Object.entries(params).reduce((accumulator, entry) => {
          const [key, value] = entry;
          let encodedValue;
          let item;
          if (Array.isArray(value)) {
            item = "";
            value.forEach((str) => {
              encodedValue = shouldEncode ? encodeURIComponent(str) : str;
              item += `${key}=${encodedValue}&`;
            });
            item.slice(0, -1);
          } else {
            encodedValue = shouldEncode ? encodeURIComponent(value) : value;
            item = `${key}=${encodedValue}`;
          }
          return `${accumulator}&${item}`;
        }, "");
        return output.substr(1);
      };
      buildRequestInit = (options, extra = {}) => {
        const output = Object.assign({ method: options.method || "GET", headers: options.headers }, extra);
        const headers = normalizeHttpHeaders(options.headers);
        const type = headers["content-type"] || "";
        if (typeof options.data === "string") {
          output.body = options.data;
        } else if (type.includes("application/x-www-form-urlencoded")) {
          const params = new URLSearchParams();
          for (const [key, value] of Object.entries(options.data || {})) {
            params.set(key, value);
          }
          output.body = params.toString();
        } else if (type.includes("multipart/form-data") || options.data instanceof FormData) {
          const form = new FormData();
          if (options.data instanceof FormData) {
            options.data.forEach((value, key) => {
              form.append(key, value);
            });
          } else {
            for (const key of Object.keys(options.data)) {
              form.append(key, options.data[key]);
            }
          }
          output.body = form;
          const headers2 = new Headers(output.headers);
          headers2.delete("content-type");
          output.headers = headers2;
        } else if (type.includes("application/json") || typeof options.data === "object") {
          output.body = JSON.stringify(options.data);
        }
        return output;
      };
      CapacitorHttpPluginWeb = class extends WebPlugin {
        /**
         * Perform an Http request given a set of options
         * @param options Options to build the HTTP request
         */
        async request(options) {
          const requestInit = buildRequestInit(options, options.webFetchExtra);
          const urlParams = buildUrlParams(options.params, options.shouldEncodeUrlParams);
          const url = urlParams ? `${options.url}?${urlParams}` : options.url;
          const response = await fetch(url, requestInit);
          const contentType = response.headers.get("content-type") || "";
          let { responseType = "text" } = response.ok ? options : {};
          if (contentType.includes("application/json")) {
            responseType = "json";
          }
          let data;
          let blob;
          switch (responseType) {
            case "arraybuffer":
            case "blob":
              blob = await response.blob();
              data = await readBlobAsBase64(blob);
              break;
            case "json":
              data = await response.json();
              break;
            case "document":
            case "text":
            default:
              data = await response.text();
          }
          const headers = {};
          response.headers.forEach((value, key) => {
            headers[key] = value;
          });
          return {
            data,
            headers,
            status: response.status,
            url: response.url
          };
        }
        /**
         * Perform an Http GET request given a set of options
         * @param options Options to build the HTTP request
         */
        async get(options) {
          return this.request(Object.assign(Object.assign({}, options), { method: "GET" }));
        }
        /**
         * Perform an Http POST request given a set of options
         * @param options Options to build the HTTP request
         */
        async post(options) {
          return this.request(Object.assign(Object.assign({}, options), { method: "POST" }));
        }
        /**
         * Perform an Http PUT request given a set of options
         * @param options Options to build the HTTP request
         */
        async put(options) {
          return this.request(Object.assign(Object.assign({}, options), { method: "PUT" }));
        }
        /**
         * Perform an Http PATCH request given a set of options
         * @param options Options to build the HTTP request
         */
        async patch(options) {
          return this.request(Object.assign(Object.assign({}, options), { method: "PATCH" }));
        }
        /**
         * Perform an Http DELETE request given a set of options
         * @param options Options to build the HTTP request
         */
        async delete(options) {
          return this.request(Object.assign(Object.assign({}, options), { method: "DELETE" }));
        }
      };
      CapacitorHttp = registerPlugin("CapacitorHttp", {
        web: () => new CapacitorHttpPluginWeb()
      });
      (function(SystemBarsStyle2) {
        SystemBarsStyle2["Dark"] = "DARK";
        SystemBarsStyle2["Light"] = "LIGHT";
        SystemBarsStyle2["Default"] = "DEFAULT";
      })(SystemBarsStyle || (SystemBarsStyle = {}));
      (function(SystemBarType2) {
        SystemBarType2["StatusBar"] = "StatusBar";
        SystemBarType2["NavigationBar"] = "NavigationBar";
      })(SystemBarType || (SystemBarType = {}));
      SystemBarsPluginWeb = class extends WebPlugin {
        async setStyle() {
          this.unavailable("not available for web");
        }
        async setAnimation() {
          this.unavailable("not available for web");
        }
        async show() {
          this.unavailable("not available for web");
        }
        async hide() {
          this.unavailable("not available for web");
        }
      };
      SystemBars = registerPlugin("SystemBars", {
        web: () => new SystemBarsPluginWeb()
      });
    }
  });

  // node_modules/@capacitor/filesystem/dist/esm/definitions.js
  var Directory, Encoding;
  var init_definitions = __esm({
    "node_modules/@capacitor/filesystem/dist/esm/definitions.js"() {
      (function(Directory2) {
        Directory2["Documents"] = "DOCUMENTS";
        Directory2["Data"] = "DATA";
        Directory2["Library"] = "LIBRARY";
        Directory2["Cache"] = "CACHE";
        Directory2["External"] = "EXTERNAL";
        Directory2["ExternalStorage"] = "EXTERNAL_STORAGE";
        Directory2["ExternalCache"] = "EXTERNAL_CACHE";
        Directory2["LibraryNoCloud"] = "LIBRARY_NO_CLOUD";
        Directory2["Temporary"] = "TEMPORARY";
      })(Directory || (Directory = {}));
      (function(Encoding2) {
        Encoding2["UTF8"] = "utf8";
        Encoding2["ASCII"] = "ascii";
        Encoding2["UTF16"] = "utf16";
      })(Encoding || (Encoding = {}));
    }
  });

  // node_modules/@capacitor/filesystem/dist/esm/web.js
  var web_exports = {};
  __export(web_exports, {
    FilesystemWeb: () => FilesystemWeb
  });
  function resolve(path) {
    const posix = path.split("/").filter((item) => item !== ".");
    const newPosix = [];
    posix.forEach((item) => {
      if (item === ".." && newPosix.length > 0 && newPosix[newPosix.length - 1] !== "..") {
        newPosix.pop();
      } else {
        newPosix.push(item);
      }
    });
    return newPosix.join("/");
  }
  function isPathParent(parent, children) {
    parent = resolve(parent);
    children = resolve(children);
    const pathsA = parent.split("/");
    const pathsB = children.split("/");
    return parent !== children && pathsA.every((value, index) => value === pathsB[index]);
  }
  var FilesystemWeb;
  var init_web = __esm({
    "node_modules/@capacitor/filesystem/dist/esm/web.js"() {
      init_dist();
      init_definitions();
      FilesystemWeb = class _FilesystemWeb extends WebPlugin {
        constructor() {
          super(...arguments);
          this.DB_VERSION = 1;
          this.DB_NAME = "Disc";
          this._writeCmds = ["add", "put", "delete"];
          this.downloadFile = async (options) => {
            var _a, _b;
            const requestInit = buildRequestInit(options, options.webFetchExtra);
            const response = await fetch(options.url, requestInit);
            let blob;
            if (!options.progress)
              blob = await response.blob();
            else if (!(response === null || response === void 0 ? void 0 : response.body))
              blob = new Blob();
            else {
              const reader = response.body.getReader();
              let bytes = 0;
              const chunks = [];
              const contentType = response.headers.get("content-type");
              const contentLength = parseInt(response.headers.get("content-length") || "0", 10);
              while (true) {
                const { done, value } = await reader.read();
                if (done)
                  break;
                chunks.push(value);
                bytes += (value === null || value === void 0 ? void 0 : value.length) || 0;
                const status = {
                  url: options.url,
                  bytes,
                  contentLength
                };
                this.notifyListeners("progress", status);
              }
              const allChunks = new Uint8Array(bytes);
              let position = 0;
              for (const chunk of chunks) {
                if (typeof chunk === "undefined")
                  continue;
                allChunks.set(chunk, position);
                position += chunk.length;
              }
              blob = new Blob([allChunks.buffer], { type: contentType || void 0 });
            }
            const result = await this.writeFile({
              path: options.path,
              directory: (_a = options.directory) !== null && _a !== void 0 ? _a : void 0,
              recursive: (_b = options.recursive) !== null && _b !== void 0 ? _b : false,
              data: blob
            });
            return { path: result.uri, blob };
          };
        }
        readFileInChunks(_options, _callback) {
          throw this.unavailable("Method not implemented.");
        }
        async initDb() {
          if (this._db !== void 0) {
            return this._db;
          }
          if (!("indexedDB" in window)) {
            throw this.unavailable("This browser doesn't support IndexedDB");
          }
          return new Promise((resolve2, reject) => {
            const request = indexedDB.open(this.DB_NAME, this.DB_VERSION);
            request.onupgradeneeded = _FilesystemWeb.doUpgrade;
            request.onsuccess = () => {
              this._db = request.result;
              resolve2(request.result);
            };
            request.onerror = () => reject(request.error);
            request.onblocked = () => {
              console.warn("db blocked");
            };
          });
        }
        static doUpgrade(event) {
          const eventTarget = event.target;
          const db = eventTarget.result;
          switch (event.oldVersion) {
            case 0:
            case 1:
            default: {
              if (db.objectStoreNames.contains("FileStorage")) {
                db.deleteObjectStore("FileStorage");
              }
              const store = db.createObjectStore("FileStorage", { keyPath: "path" });
              store.createIndex("by_folder", "folder");
            }
          }
        }
        async dbRequest(cmd, args) {
          const readFlag = this._writeCmds.indexOf(cmd) !== -1 ? "readwrite" : "readonly";
          return this.initDb().then((conn) => {
            return new Promise((resolve2, reject) => {
              const tx = conn.transaction(["FileStorage"], readFlag);
              const store = tx.objectStore("FileStorage");
              const req = store[cmd](...args);
              req.onsuccess = () => resolve2(req.result);
              req.onerror = () => reject(req.error);
            });
          });
        }
        async dbIndexRequest(indexName, cmd, args) {
          const readFlag = this._writeCmds.indexOf(cmd) !== -1 ? "readwrite" : "readonly";
          return this.initDb().then((conn) => {
            return new Promise((resolve2, reject) => {
              const tx = conn.transaction(["FileStorage"], readFlag);
              const store = tx.objectStore("FileStorage");
              const index = store.index(indexName);
              const req = index[cmd](...args);
              req.onsuccess = () => resolve2(req.result);
              req.onerror = () => reject(req.error);
            });
          });
        }
        getPath(directory, uriPath) {
          const cleanedUriPath = uriPath !== void 0 ? uriPath.replace(/^[/]+|[/]+$/g, "") : "";
          let fsPath = "";
          if (directory !== void 0)
            fsPath += "/" + directory;
          if (uriPath !== "")
            fsPath += "/" + cleanedUriPath;
          return fsPath;
        }
        async clear() {
          const conn = await this.initDb();
          const tx = conn.transaction(["FileStorage"], "readwrite");
          const store = tx.objectStore("FileStorage");
          store.clear();
        }
        /**
         * Read a file from disk
         * @param options options for the file read
         * @return a promise that resolves with the read file data result
         */
        async readFile(options) {
          const path = this.getPath(options.directory, options.path);
          const entry = await this.dbRequest("get", [path]);
          if (entry === void 0)
            throw Error("File does not exist.");
          return { data: entry.content ? entry.content : "" };
        }
        /**
         * Write a file to disk in the specified location on device
         * @param options options for the file write
         * @return a promise that resolves with the file write result
         */
        async writeFile(options) {
          const path = this.getPath(options.directory, options.path);
          let data = options.data;
          const encoding = options.encoding;
          const doRecursive = options.recursive;
          const occupiedEntry = await this.dbRequest("get", [path]);
          if (occupiedEntry && occupiedEntry.type === "directory")
            throw Error("The supplied path is a directory.");
          const parentPath = path.substr(0, path.lastIndexOf("/"));
          const parentEntry = await this.dbRequest("get", [parentPath]);
          if (parentEntry === void 0) {
            const subDirIndex = parentPath.indexOf("/", 1);
            if (subDirIndex !== -1) {
              const parentArgPath = parentPath.substr(subDirIndex);
              await this.mkdir({
                path: parentArgPath,
                directory: options.directory,
                recursive: doRecursive
              });
            }
          }
          if (!encoding && !(data instanceof Blob)) {
            data = data.indexOf(",") >= 0 ? data.split(",")[1] : data;
            if (!this.isBase64String(data))
              throw Error("The supplied data is not valid base64 content.");
          }
          const now = Date.now();
          const pathObj = {
            path,
            folder: parentPath,
            type: "file",
            size: data instanceof Blob ? data.size : data.length,
            ctime: now,
            mtime: now,
            content: data
          };
          await this.dbRequest("put", [pathObj]);
          return {
            uri: pathObj.path
          };
        }
        /**
         * Append to a file on disk in the specified location on device
         * @param options options for the file append
         * @return a promise that resolves with the file write result
         */
        async appendFile(options) {
          const path = this.getPath(options.directory, options.path);
          let data = options.data;
          const encoding = options.encoding;
          const parentPath = path.substr(0, path.lastIndexOf("/"));
          const now = Date.now();
          let ctime = now;
          const occupiedEntry = await this.dbRequest("get", [path]);
          if (occupiedEntry && occupiedEntry.type === "directory")
            throw Error("The supplied path is a directory.");
          const parentEntry = await this.dbRequest("get", [parentPath]);
          if (parentEntry === void 0) {
            const subDirIndex = parentPath.indexOf("/", 1);
            if (subDirIndex !== -1) {
              const parentArgPath = parentPath.substr(subDirIndex);
              await this.mkdir({
                path: parentArgPath,
                directory: options.directory,
                recursive: true
              });
            }
          }
          if (!encoding && !this.isBase64String(data))
            throw Error("The supplied data is not valid base64 content.");
          if (occupiedEntry !== void 0) {
            if (occupiedEntry.content instanceof Blob) {
              throw Error("The occupied entry contains a Blob object which cannot be appended to.");
            }
            if (occupiedEntry.content !== void 0 && !encoding) {
              data = btoa(atob(occupiedEntry.content) + atob(data));
            } else {
              data = occupiedEntry.content + data;
            }
            ctime = occupiedEntry.ctime;
          }
          const pathObj = {
            path,
            folder: parentPath,
            type: "file",
            size: data.length,
            ctime,
            mtime: now,
            content: data
          };
          await this.dbRequest("put", [pathObj]);
        }
        /**
         * Delete a file from disk
         * @param options options for the file delete
         * @return a promise that resolves with the deleted file data result
         */
        async deleteFile(options) {
          const path = this.getPath(options.directory, options.path);
          const entry = await this.dbRequest("get", [path]);
          if (entry === void 0)
            throw Error("File does not exist.");
          const entries = await this.dbIndexRequest("by_folder", "getAllKeys", [IDBKeyRange.only(path)]);
          if (entries.length !== 0)
            throw Error("Folder is not empty.");
          await this.dbRequest("delete", [path]);
        }
        /**
         * Create a directory.
         * @param options options for the mkdir
         * @return a promise that resolves with the mkdir result
         */
        async mkdir(options) {
          const path = this.getPath(options.directory, options.path);
          const doRecursive = options.recursive;
          const parentPath = path.substr(0, path.lastIndexOf("/"));
          const depth = (path.match(/\//g) || []).length;
          const parentEntry = await this.dbRequest("get", [parentPath]);
          const occupiedEntry = await this.dbRequest("get", [path]);
          if (depth === 1)
            throw Error("Cannot create Root directory");
          if (occupiedEntry !== void 0)
            throw Error("Current directory does already exist.");
          if (!doRecursive && depth !== 2 && parentEntry === void 0)
            throw Error("Parent directory must exist");
          if (doRecursive && depth !== 2 && parentEntry === void 0) {
            const parentArgPath = parentPath.substr(parentPath.indexOf("/", 1));
            await this.mkdir({
              path: parentArgPath,
              directory: options.directory,
              recursive: doRecursive
            });
          }
          const now = Date.now();
          const pathObj = {
            path,
            folder: parentPath,
            type: "directory",
            size: 0,
            ctime: now,
            mtime: now
          };
          await this.dbRequest("put", [pathObj]);
        }
        /**
         * Remove a directory
         * @param options the options for the directory remove
         */
        async rmdir(options) {
          const { path, directory, recursive } = options;
          const fullPath = this.getPath(directory, path);
          const entry = await this.dbRequest("get", [fullPath]);
          if (entry === void 0)
            throw Error("Folder does not exist.");
          if (entry.type !== "directory")
            throw Error("Requested path is not a directory");
          const readDirResult = await this.readdir({ path, directory });
          if (readDirResult.files.length !== 0 && !recursive)
            throw Error("Folder is not empty");
          for (const entry2 of readDirResult.files) {
            const entryPath = `${path}/${entry2.name}`;
            const entryObj = await this.stat({ path: entryPath, directory });
            if (entryObj.type === "file") {
              await this.deleteFile({ path: entryPath, directory });
            } else {
              await this.rmdir({ path: entryPath, directory, recursive });
            }
          }
          await this.dbRequest("delete", [fullPath]);
        }
        /**
         * Return a list of files from the directory (not recursive)
         * @param options the options for the readdir operation
         * @return a promise that resolves with the readdir directory listing result
         */
        async readdir(options) {
          const path = this.getPath(options.directory, options.path);
          const entry = await this.dbRequest("get", [path]);
          if (options.path !== "" && entry === void 0)
            throw Error("Folder does not exist.");
          const entries = await this.dbIndexRequest("by_folder", "getAllKeys", [IDBKeyRange.only(path)]);
          const files = await Promise.all(entries.map(async (e) => {
            let subEntry = await this.dbRequest("get", [e]);
            if (subEntry === void 0) {
              subEntry = await this.dbRequest("get", [e + "/"]);
            }
            return {
              name: e.substring(path.length + 1),
              type: subEntry.type,
              size: subEntry.size,
              ctime: subEntry.ctime,
              mtime: subEntry.mtime,
              uri: subEntry.path
            };
          }));
          return { files };
        }
        /**
         * Return full File URI for a path and directory
         * @param options the options for the stat operation
         * @return a promise that resolves with the file stat result
         */
        async getUri(options) {
          const path = this.getPath(options.directory, options.path);
          let entry = await this.dbRequest("get", [path]);
          if (entry === void 0) {
            entry = await this.dbRequest("get", [path + "/"]);
          }
          return {
            uri: (entry === null || entry === void 0 ? void 0 : entry.path) || path
          };
        }
        /**
         * Return data about a file
         * @param options the options for the stat operation
         * @return a promise that resolves with the file stat result
         */
        async stat(options) {
          const path = this.getPath(options.directory, options.path);
          let entry = await this.dbRequest("get", [path]);
          if (entry === void 0) {
            entry = await this.dbRequest("get", [path + "/"]);
          }
          if (entry === void 0)
            throw Error("Entry does not exist.");
          return {
            name: entry.path.substring(path.length + 1),
            type: entry.type,
            size: entry.size,
            ctime: entry.ctime,
            mtime: entry.mtime,
            uri: entry.path
          };
        }
        /**
         * Rename a file or directory
         * @param options the options for the rename operation
         * @return a promise that resolves with the rename result
         */
        async rename(options) {
          await this._copy(options, true);
          return;
        }
        /**
         * Copy a file or directory
         * @param options the options for the copy operation
         * @return a promise that resolves with the copy result
         */
        async copy(options) {
          return this._copy(options, false);
        }
        async requestPermissions() {
          return { publicStorage: "granted" };
        }
        async checkPermissions() {
          return { publicStorage: "granted" };
        }
        /**
         * Function that can perform a copy or a rename
         * @param options the options for the rename operation
         * @param doRename whether to perform a rename or copy operation
         * @return a promise that resolves with the result
         */
        async _copy(options, doRename = false) {
          let { toDirectory } = options;
          const { to, from, directory: fromDirectory } = options;
          if (!to || !from) {
            throw Error("Both to and from must be provided");
          }
          if (!toDirectory) {
            toDirectory = fromDirectory;
          }
          const fromPath = this.getPath(fromDirectory, from);
          const toPath = this.getPath(toDirectory, to);
          if (fromPath === toPath) {
            return {
              uri: toPath
            };
          }
          if (isPathParent(fromPath, toPath)) {
            throw Error("To path cannot contain the from path");
          }
          let toObj;
          try {
            toObj = await this.stat({
              path: to,
              directory: toDirectory
            });
          } catch (e) {
            const toPathComponents = to.split("/");
            toPathComponents.pop();
            const toPath2 = toPathComponents.join("/");
            if (toPathComponents.length > 0) {
              const toParentDirectory = await this.stat({
                path: toPath2,
                directory: toDirectory
              });
              if (toParentDirectory.type !== "directory") {
                throw new Error("Parent directory of the to path is a file");
              }
            }
          }
          if (toObj && toObj.type === "directory") {
            throw new Error("Cannot overwrite a directory with a file");
          }
          const fromObj = await this.stat({
            path: from,
            directory: fromDirectory
          });
          const updateTime = async (path, ctime2, mtime) => {
            const fullPath = this.getPath(toDirectory, path);
            const entry = await this.dbRequest("get", [fullPath]);
            entry.ctime = ctime2;
            entry.mtime = mtime;
            await this.dbRequest("put", [entry]);
          };
          const ctime = fromObj.ctime ? fromObj.ctime : Date.now();
          switch (fromObj.type) {
            // The "from" object is a file
            case "file": {
              const file = await this.readFile({
                path: from,
                directory: fromDirectory
              });
              if (doRename) {
                await this.deleteFile({
                  path: from,
                  directory: fromDirectory
                });
              }
              let encoding;
              if (!(file.data instanceof Blob) && !this.isBase64String(file.data)) {
                encoding = Encoding.UTF8;
              }
              const writeResult = await this.writeFile({
                path: to,
                directory: toDirectory,
                data: file.data,
                encoding
              });
              if (doRename) {
                await updateTime(to, ctime, fromObj.mtime);
              }
              return writeResult;
            }
            case "directory": {
              if (toObj) {
                throw Error("Cannot move a directory over an existing object");
              }
              try {
                await this.mkdir({
                  path: to,
                  directory: toDirectory,
                  recursive: false
                });
                if (doRename) {
                  await updateTime(to, ctime, fromObj.mtime);
                }
              } catch (e) {
              }
              const contents = (await this.readdir({
                path: from,
                directory: fromDirectory
              })).files;
              for (const filename of contents) {
                await this._copy({
                  from: `${from}/${filename.name}`,
                  to: `${to}/${filename.name}`,
                  directory: fromDirectory,
                  toDirectory
                }, doRename);
              }
              if (doRename) {
                await this.rmdir({
                  path: from,
                  directory: fromDirectory
                });
              }
            }
          }
          return {
            uri: toPath
          };
        }
        isBase64String(str) {
          try {
            return btoa(atob(str)) == str;
          } catch (err) {
            return false;
          }
        }
      };
      FilesystemWeb._debug = true;
    }
  });

  // node_modules/@capacitor/preferences/dist/esm/web.js
  var web_exports2 = {};
  __export(web_exports2, {
    PreferencesWeb: () => PreferencesWeb
  });
  var PreferencesWeb;
  var init_web2 = __esm({
    "node_modules/@capacitor/preferences/dist/esm/web.js"() {
      init_dist();
      PreferencesWeb = class extends WebPlugin {
        constructor() {
          super(...arguments);
          this.group = "CapacitorStorage";
        }
        async configure({ group }) {
          if (typeof group === "string") {
            this.group = group;
          }
        }
        async get(options) {
          const value = this.impl.getItem(this.applyPrefix(options.key));
          return { value };
        }
        async set(options) {
          this.impl.setItem(this.applyPrefix(options.key), options.value);
        }
        async remove(options) {
          this.impl.removeItem(this.applyPrefix(options.key));
        }
        async keys() {
          const keys = this.rawKeys().map((k) => k.substring(this.prefix.length));
          return { keys };
        }
        async clear() {
          for (const key of this.rawKeys()) {
            this.impl.removeItem(key);
          }
        }
        async migrate() {
          var _a;
          const migrated = [];
          const existing = [];
          const oldprefix = "_cap_";
          const keys = Object.keys(this.impl).filter((k) => k.indexOf(oldprefix) === 0);
          for (const oldkey of keys) {
            const key = oldkey.substring(oldprefix.length);
            const value = (_a = this.impl.getItem(oldkey)) !== null && _a !== void 0 ? _a : "";
            const { value: currentValue } = await this.get({ key });
            if (typeof currentValue === "string") {
              existing.push(key);
            } else {
              await this.set({ key, value });
              migrated.push(key);
            }
          }
          return { migrated, existing };
        }
        async removeOld() {
          const oldprefix = "_cap_";
          const keys = Object.keys(this.impl).filter((k) => k.indexOf(oldprefix) === 0);
          for (const oldkey of keys) {
            this.impl.removeItem(oldkey);
          }
        }
        get impl() {
          return window.localStorage;
        }
        get prefix() {
          return this.group === "NativeStorage" ? "" : `${this.group}.`;
        }
        rawKeys() {
          return Object.keys(this.impl).filter((k) => k.indexOf(this.prefix) === 0);
        }
        applyPrefix(key) {
          return this.prefix + key;
        }
      };
    }
  });

  // node_modules/@capacitor/filesystem/dist/esm/index.js
  init_dist();

  // node_modules/@capacitor/synapse/dist/synapse.mjs
  function s(t) {
    t.CapacitorUtils.Synapse = new Proxy(
      {},
      {
        get(e, n) {
          return new Proxy({}, {
            get(w, o) {
              return (c, p, r) => {
                const i = t.Capacitor.Plugins[n];
                if (i === void 0) {
                  r(new Error(`Capacitor plugin ${n} not found`));
                  return;
                }
                if (typeof i[o] != "function") {
                  r(new Error(`Method ${o} not found in Capacitor plugin ${n}`));
                  return;
                }
                (async () => {
                  try {
                    const a = await i[o](c);
                    p(a);
                  } catch (a) {
                    r(a);
                  }
                })();
              };
            }
          });
        }
      }
    );
  }
  function u(t) {
    t.CapacitorUtils.Synapse = new Proxy(
      {},
      {
        get(e, n) {
          return t.cordova.plugins[n];
        }
      }
    );
  }
  function f(t = false) {
    typeof window > "u" || (window.CapacitorUtils = window.CapacitorUtils || {}, window.Capacitor !== void 0 && !t ? s(window) : window.cordova !== void 0 && u(window));
  }

  // node_modules/@capacitor/filesystem/dist/esm/index.js
  init_definitions();
  var Filesystem = registerPlugin("Filesystem", {
    web: () => Promise.resolve().then(() => (init_web(), web_exports)).then((m) => new m.FilesystemWeb())
  });
  f();

  // node_modules/@capacitor/preferences/dist/esm/index.js
  init_dist();
  var Preferences = registerPlugin("Preferences", {
    web: () => Promise.resolve().then(() => (init_web2(), web_exports2)).then((m) => new m.PreferencesWeb())
  });

  // src/playbooks-data.ts
  var PLAYBOOKS = {
    "action_recipe": {
      "id": "action_recipe",
      "version": "0.1.0",
      "kind": "derived",
      "sector": "action",
      "title": "Action recipe",
      "purpose": "Turns your success formula into concrete moves in the real world. The premise, from career construction theory: action, not decidedness, carries you forward \u2014 you learn which future you want by exploring it. The plan names two or three directions that fit your authorized artifacts, assigns each the book's information-seeking behaviors (writing, observing, reading, listening, visiting, talking), sets three first steps for the coming week, and names the barrier most likely to stall you \u2014 with its counter-move. Everything must occur in the real world, and you authorize all of it.\n",
      "consumes": [
        "identity_statement",
        "life_portrait",
        "preferred_settings",
        "counseling_goal"
      ],
      "invalidates": [
        "closing_check"
      ],
      "induce": {
        "steps": [
          {
            "id": "plan",
            "task": "From the identity statement, life portrait, and preferred settings, draft the user's exploration plan, second person. Propose two or three directions (occupations, roles, or paths) that would let the user live their formula \u2014 for each, say in one sentence why it fits their authorized artifacts (cite their own words where possible), name its exploration stage (crystallize: comparing broad options; specify: deepening one; actualize: securing a real position or trial), and give two or three concrete exploration actions drawn from the six information-seeking behaviors \u2014 writing, observing, reading, listening, visiting, talking \u2014 each naming a real-world step the user could take. Then set week_one: the three smallest concrete moves for the next seven days. Finally, from the portrait's tensions, name the single most likely barrier for THIS user (a feeling like anxiety or guilt, a practical constraint, or an unsupportive audience) and give one gentle counter-move; if the barrier is a feeling, name it kindly. No generic advice: every item must trace back to the user's artifacts.\n",
            "model_tier": "large",
            "output_schema": {
              "type": "object",
              "required": [
                "directions",
                "week_one",
                "barrier"
              ],
              "properties": {
                "directions": {
                  "type": "array",
                  "minItems": 2,
                  "maxItems": 3,
                  "items": {
                    "type": "object",
                    "required": [
                      "name",
                      "why_it_fits",
                      "stage",
                      "actions"
                    ],
                    "properties": {
                      "name": {
                        "type": "string"
                      },
                      "why_it_fits": {
                        "type": "string"
                      },
                      "stage": {
                        "type": "string",
                        "enum": [
                          "crystallize",
                          "specify",
                          "actualize"
                        ]
                      },
                      "actions": {
                        "type": "array",
                        "minItems": 2,
                        "maxItems": 3,
                        "items": {
                          "type": "object",
                          "required": [
                            "behavior",
                            "step"
                          ],
                          "properties": {
                            "behavior": {
                              "type": "string",
                              "enum": [
                                "writing",
                                "observing",
                                "reading",
                                "listening",
                                "visiting",
                                "talking"
                              ]
                            },
                            "step": {
                              "type": "string"
                            }
                          }
                        }
                      }
                    }
                  }
                },
                "week_one": {
                  "type": "array",
                  "minItems": 3,
                  "maxItems": 3,
                  "items": {
                    "type": "string"
                  }
                },
                "barrier": {
                  "type": "object",
                  "required": [
                    "name",
                    "counter_move"
                  ],
                  "properties": {
                    "name": {
                      "type": "string"
                    },
                    "counter_move": {
                      "type": "string"
                    }
                  }
                }
              }
            }
          }
        ]
      },
      "confirm": {
        "present": "structured_review",
        "authorize_language": "This plan only counts if it happens in the real world \u2014 trim anything you won't actually do, and make the first steps embarrassingly small. When you've explored, come back for the closing check.\n"
      },
      "artifact": {
        "schema": {
          "type": "object",
          "required": [
            "directions",
            "week_one",
            "barrier"
          ],
          "properties": {
            "directions": {
              "type": "array"
            },
            "week_one": {
              "type": "array",
              "items": {
                "type": "string"
              }
            },
            "barrier": {
              "type": "object"
            }
          }
        },
        "render": "{{#each week_one}}\u2022 {{this}}\n{{/each}}\n"
      },
      "gate": "all"
    },
    "advice_to_self": {
      "id": "advice_to_self",
      "version": "0.1.0",
      "kind": "derived",
      "sector": "induction",
      "title": "Advice to self",
      "purpose": "Unpacks your motto into the call to action it already contains. The premise, from career construction theory: a favorite saying is autotherapy \u2014 the best advice you have for yourself, usually stating your own strategy for moving to the next chapter. The answers you seek were already in your pocket; this step just says so plainly. Your motto stays word-for-word yours, and it will be handed back to you at the very end of the journey.\n",
      "consumes": [
        "motto",
        "counseling_goal"
      ],
      "invalidates": [
        "life_portrait"
      ],
      "induce": {
        "steps": [
          {
            "id": "unpack",
            "task": "Take the motto exactly as recorded and unfold the advice it contains, addressed to the user in the second person. Connect it directly to the request in the counseling goal: how does this saying answer the very thing the user came here for? State the concrete move the motto is telling the user to make next. Do not improve, correct, or replace the motto \u2014 the wisdom must remain the user's own, only made explicit.\n",
            "model_tier": "small",
            "output_schema": {
              "type": "object",
              "required": [
                "motto",
                "call_to_action",
                "answers_the_request"
              ],
              "properties": {
                "motto": {
                  "type": "string",
                  "x-verbatim": true,
                  "description": "The saying, exactly as the user recorded it."
                },
                "call_to_action": {
                  "type": "string",
                  "description": "Two or three second-person sentences \u2014 the move the motto is already advising."
                },
                "answers_the_request": {
                  "type": "string",
                  "description": "One or two sentences connecting the motto to the user's stated goal."
                }
              }
            }
          }
        ]
      },
      "confirm": {
        "present": "structured_review",
        "authorize_language": "This is your own advice, said back to you plainly \u2014 adjust anything that doesn't sound like what you meant. The life portrait builds on what you approve here.\n"
      },
      "artifact": {
        "schema": {
          "type": "object",
          "required": [
            "motto",
            "call_to_action"
          ],
          "properties": {
            "motto": {
              "type": "string"
            },
            "call_to_action": {
              "type": "string"
            },
            "answers_the_request": {
              "type": "string"
            }
          }
        },
        "render": "\u201C{{motto}}\u201D \u2014 {{call_to_action}}\n"
      }
    },
    "character_sketch": {
      "id": "character_sketch",
      "version": "0.1.0",
      "kind": "derived",
      "sector": "induction",
      "title": "Character sketch",
      "purpose": "Composes a short portrait of who you are \u2014 built only from the words you approved in the role models step. The premise, from career construction theory: the traits you admired in your childhood models are the blueprint you used to build yourself, and they exist as your solution to what preoccupied you early on (bravery exists to solve fear). When your perspective artifact is available, the sketch is framed that way. Nothing is invented here: every trait must be a quote of your own words, and you edit and authorize the result.\n",
      "consumes": [
        "role_models",
        "perspective",
        "counseling_goal"
      ],
      "invalidates": [
        "script",
        "life_portrait"
      ],
      "induce": {
        "steps": [
          {
            "id": "sketch",
            "task": `Compose a second-person character sketch of four to eight sentences, addressed to the user ("You are\u2026"), from the role_models artifact. Anchor it on the primacy trait (weight it most) and the repeated traits. Quote the user's descriptor words rather than substituting synonyms. Show with concrete phrasing instead of abstract labels. If a perspective artifact is present, frame the traits as the solution the user constructed to the preoccupation it names \u2014 the way bravery solves fear. If two traits sit in tension, keep the tension visible rather than smoothing it over. Never add a trait the user did not state.
`,
            "model_tier": "large",
            "output_schema": {
              "type": "object",
              "required": [
                "sketch",
                "core_traits",
                "solves"
              ],
              "properties": {
                "sketch": {
                  "type": "string",
                  "description": "The portrait prose, second person."
                },
                "core_traits": {
                  "type": "array",
                  "minItems": 2,
                  "items": {
                    "type": "string",
                    "x-verbatim": true
                  },
                  "description": "The trait words the sketch is built on, quoted exactly."
                },
                "solves": {
                  "type": [
                    "string",
                    "null"
                  ],
                  "description": "The preoccupation these traits answer, when the perspective artifact is available; otherwise null."
                }
              }
            }
          }
        ]
      },
      "confirm": {
        "present": "structured_review",
        "authorize_language": "This sketch is assembled only from your own words. Reword anything that doesn't sound like you \u2014 the script and the life portrait will build on what you approve here.\n"
      },
      "artifact": {
        "schema": {
          "type": "object",
          "required": [
            "sketch",
            "core_traits"
          ],
          "properties": {
            "sketch": {
              "type": "string"
            },
            "core_traits": {
              "type": "array",
              "items": {
                "type": "string"
              }
            },
            "solves": {
              "type": [
                "string",
                "null"
              ]
            }
          }
        },
        "render": "{{sketch}}\n"
      }
    },
    "closing_check": {
      "id": "closing_check",
      "version": "0.1.0",
      "kind": "conversation",
      "sector": "action",
      "title": "Closing check",
      "purpose": "The closing ritual, straight from the book. Your original request is read back to you word for word, and you \u2014 no one else \u2014 judge whether it was met. Then you name what's different now, because saying the change out loud is what makes it stick. And at the very end, your own motto is handed back to you: the advice you carried all along, now with a journey behind it. This step records your verdict; it changes nothing else.\n",
      "consumes": [
        "counseling_goal",
        "action_recipe",
        "motto"
      ],
      "invalidates": [],
      "elicit": {
        "share_upstream": true,
        "persona": "Warm, unhurried, celebratory without flattery. This is a ritual of\nclosure, not another interview. One question at a time. When quoting the\nuser's request or motto from the artifacts, quote them exactly, word for\nword \u2014 never paraphrase them.\n",
        "guardrails": [
          'The user is the only judge of whether their request was met. Accept "partly" and "no" with full respect and without defending the process.',
          "Quote the counseling_goal request_verbatim and the motto exactly as they appear in the artifacts. Never edit, shorten, or improve them.",
          "Do not open new counseling topics; if something big surfaces, note warmly that the map can be revisited any time."
        ],
        "stages": [
          {
            "id": "verdict",
            "goal": "The user's own judgment on whether their original request was met.",
            "opening": "We've reached the end of the map. Ready to check the journey against where you started?\n",
            "opening_i18n": {
              "ru": "\u041C\u044B \u0434\u043E\u0448\u043B\u0438 \u0434\u043E \u043A\u043E\u043D\u0446\u0430 \u043A\u0430\u0440\u0442\u044B. \u0413\u043E\u0442\u043E\u0432 \u0441\u0432\u0435\u0440\u0438\u0442\u044C \u043F\u0443\u0442\u044C \u0441 \u0442\u0435\u043C, \u0441 \u0447\u0435\u0433\u043E \u0442\u044B \u043D\u0430\u0447\u0438\u043D\u0430\u043B?\n"
            },
            "probes": [
              {
                "when": "the user is ready",
                "then": "Read their original request back word for word from the counseling_goal artifact, then ask \u2014 did we get there?"
              },
              {
                "when": 'the verdict is "partly" or "no"',
                "then": "Ask what remains unanswered, and note which checkpoint on the map speaks to it \u2014 revisiting is how this process is meant to work."
              }
            ],
            "done_when": [
              "The user has given a verdict on their original request \u2014 met, partly, or not."
            ]
          },
          {
            "id": "difference",
            "goal": "The change, said in the user's own words.",
            "opening": "And compared with the day you first answered that question \u2014 what's different now?\n",
            "probes": [
              {
                "when": "the user answers abstractly",
                "then": "Ask what they now do, or are about to do, that they weren't doing before."
              }
            ],
            "done_when": [
              "The user has named at least one concrete difference."
            ]
          },
          {
            "id": "sendoff",
            "goal": "Hand the motto back and close.",
            "opening": "One last thing before you go.\n",
            "probes": [
              {
                "when": "opening the send-off",
                "then": "Tell the user they had the answer with them all along, quote their motto word for word from the motto artifact, and wish them well on the next chapter \u2014 briefly and warmly."
              }
            ],
            "done_when": [
              "The user has responded to the send-off in any way."
            ]
          }
        ]
      },
      "induce": {
        "steps": [
          {
            "id": "record",
            "task": "Record the closing verdict from the conversation. Quote the user's own words for the verdict and the difference they named.\n",
            "model_tier": "small",
            "output_schema": {
              "type": "object",
              "required": [
                "goal_met",
                "verdict_words",
                "whats_different"
              ],
              "properties": {
                "goal_met": {
                  "type": "string",
                  "enum": [
                    "yes",
                    "partly",
                    "no"
                  ]
                },
                "verdict_words": {
                  "type": "array",
                  "minItems": 1,
                  "items": {
                    "type": "string",
                    "x-verbatim": true
                  }
                },
                "whats_different": {
                  "type": "array",
                  "minItems": 1,
                  "items": {
                    "type": "string",
                    "x-verbatim": true
                  }
                },
                "remaining": {
                  "type": [
                    "string",
                    "null"
                  ],
                  "description": "What still feels unanswered, if the user said so; null otherwise."
                }
              }
            }
          }
        ]
      },
      "confirm": {
        "present": "structured_review",
        "authorize_language": "The journey is yours, and so is this record of it. The map stays open \u2014 any checkpoint can be revisited, and your goal can be amended for a new round whenever life asks for one.\n"
      },
      "artifact": {
        "schema": {
          "type": "object",
          "required": [
            "goal_met",
            "verdict_words",
            "whats_different"
          ],
          "properties": {
            "goal_met": {
              "type": "string"
            },
            "verdict_words": {
              "type": "array",
              "items": {
                "type": "string"
              }
            },
            "whats_different": {
              "type": "array",
              "items": {
                "type": "string"
              }
            },
            "remaining": {
              "type": [
                "string",
                "null"
              ]
            }
          }
        },
        "render": "{{goal_met}} \u2014 {{#each whats_different}}{{this}}; {{/each}}\n"
      }
    },
    "counseling_goal": {
      "id": "counseling_goal",
      "version": "0.1.0",
      "kind": "conversation",
      "sector": "goal",
      "title": "Counseling goal",
      "purpose": "Establish, in your own words, what you want from this whole process. Your answer becomes the lens for every later step, and at the very end it is read back to you to ask: did we get there? Nothing is analyzed here beyond restating what you said, and you approve the restatement. You can amend the goal later \u2014 your original wording is always kept for that final check.\n",
      "consumes": [],
      "invalidates": [
        "perspective",
        "character_sketch",
        "preferred_settings",
        "script",
        "advice_to_self",
        "life_portrait",
        "identity_statement",
        "action_recipe"
      ],
      "amendable_after": "life_portrait",
      "elicit": {
        "persona": "You are a career construction interviewer opening a consultation. Warm, brief,\nunhurried. Ask one question at a time. In this phase you never analyze,\ndiagnose, or advise. When you reflect something back, use the user's own words.\n",
        "guardrails": [
          "Never propose or suggest goals; only ask and reflect.",
          "If the user asks for a test or personality assessment, explain in one sentence that this process works through their own stories instead, then return to the question.",
          "Listen for the request behind the request, and ask about it \u2014 but the user decides what their goal is. Do not overrule their framing.",
          "If the user expresses acute distress or mentions self-harm, acknowledge with care, provide crisis resources, and pause the interview."
        ],
        "stages": [
          {
            "id": "open",
            "goal": "Capture the request in the user's own words.",
            "opening": "How can this process be useful to you as you construct your career?\n",
            "opening_i18n": {
              "ru": "\u0427\u0435\u043C \u044D\u0442\u043E\u0442 \u043F\u0440\u043E\u0446\u0435\u0441\u0441 \u043C\u043E\u0436\u0435\u0442 \u0431\u044B\u0442\u044C \u043F\u043E\u043B\u0435\u0437\u0435\u043D \u0442\u0435\u0431\u0435 \u0432 \u043F\u043E\u0441\u0442\u0440\u043E\u0435\u043D\u0438\u0438 \u0442\u0432\u043E\u0435\u0439 \u043A\u0430\u0440\u044C\u0435\u0440\u044B?\n"
            },
            "probes": [
              {
                "when": 'the answer is a single broad phrase ("figure things out", "career change", "find my path")',
                "then": "Ask what would make this genuinely worth their time."
              },
              {
                "when": "several distinct requests appear",
                "then": "Reflect the list back in their words and ask which matters most right now."
              },
              {
                "when": "the request is about making a decision",
                "then": "Ask gently whether the hard part is making the choice, or understanding what is blocking the choice. Clients who ask for help choosing often actually want to know what holds them back."
              },
              {
                "when": "the request sounds like confirming a decision already made",
                "then": "Ask what kind of reassurance would help, and from whom."
              }
            ],
            "done_when": [
              "The user has stated a request in at least one full sentence."
            ]
          },
          {
            "id": "success",
            "goal": "Elicit at least one concrete success criterion.",
            "opening": "Imagine we finish and it was worth it. What are you walking away with?\n",
            "probes": [
              {
                "when": "the answer restates the goal abstractly",
                "then": "Ask what they would do differently the following week if this worked."
              }
            ],
            "done_when": [
              "At least one concrete success criterion has been stated."
            ]
          },
          {
            "id": "wrap",
            "goal": "Reflect and close.",
            "opening": "Reflect the request and success criteria back in the user's own words and ask whether anything is missing.\n",
            "done_when": [
              "The user has confirmed the reflection or finished adding to it."
            ]
          }
        ]
      },
      "induce": {
        "steps": [
          {
            "id": "extract",
            "task": "Extract the goal fields from the transcript.",
            "model_tier": "small",
            "output_schema": {
              "type": "object",
              "required": [
                "request_verbatim",
                "success_criteria",
                "request_type"
              ],
              "properties": {
                "request_verbatim": {
                  "type": "string",
                  "x-verbatim": true,
                  "description": "The user's request exactly as they first stated it."
                },
                "success_criteria": {
                  "type": "array",
                  "items": {
                    "type": "string",
                    "x-verbatim": true
                  },
                  "minItems": 1
                },
                "request_type": {
                  "type": "string",
                  "enum": [
                    "make_a_choice",
                    "understand_whats_blocking",
                    "reassurance",
                    "meaning_or_direction",
                    "transition_or_dislocation",
                    "other"
                  ]
                },
                "feelings_mentioned": {
                  "type": "array",
                  "items": {
                    "type": "string",
                    "x-verbatim": true
                  }
                }
              }
            }
          },
          {
            "id": "restate",
            "task": "Draft alternative one-sentence restatements of the goal, each assembled only from the user's own phrases.\n",
            "model_tier": "small",
            "output_schema": {
              "type": "object",
              "required": [
                "candidates"
              ],
              "properties": {
                "candidates": {
                  "type": "array",
                  "x-candidates": true,
                  "minItems": 2,
                  "maxItems": 3,
                  "items": {
                    "type": "string"
                  }
                }
              }
            },
            "validation": [
              "Every content-bearing phrase in each candidate must appear verbatim in the transcript; connective words may be added."
            ]
          }
        ]
      },
      "confirm": {
        "present": "candidates",
        "choice_field": "restated_goal",
        "authorize_language": "This is the question we will keep returning to. You can amend it after you see your life portrait \u2014 your original wording stays saved for the final check.\n"
      },
      "artifact": {
        "schema": {
          "type": "object",
          "required": [
            "request_verbatim",
            "restated_goal",
            "success_criteria",
            "request_type"
          ],
          "properties": {
            "request_verbatim": {
              "type": "string"
            },
            "restated_goal": {
              "type": "string"
            },
            "success_criteria": {
              "type": "array",
              "items": {
                "type": "string"
              }
            },
            "request_type": {
              "type": "string"
            },
            "feelings_mentioned": {
              "type": "array",
              "items": {
                "type": "string"
              }
            },
            "amendments": {
              "type": "array",
              "items": {
                "type": "object",
                "properties": {
                  "date": {
                    "type": "string"
                  },
                  "restated_goal": {
                    "type": "string"
                  },
                  "reason": {
                    "type": "string"
                  }
                }
              }
            }
          }
        },
        "render": "\u201C{{request_verbatim}}\u201D\n\u2192 {{restated_goal}}\nWorth it if: {{#each success_criteria}}{{this}}; {{/each}}\n"
      }
    },
    "early_recollections": {
      "id": "early_recollections",
      "version": "0.1.0",
      "kind": "conversation",
      "sector": "interview",
      "title": "Early recollections",
      "purpose": "You'll share three early memories from roughly ages three to six, name the feeling in each, and give each one a headline \u2014 like a newspaper headline, with a verb in it. The premise, from career construction theory: early memories are not history, they are the present \u2014 the stories you reach for today reveal the perspective from which you view your current transition. This is the most personal step of the whole interview. You can skip it entirely (type /skip in each topic): the perspective artifact can be inferred from your role models instead. Memories do not need to be verified facts; whatever comes to mind counts. This step only records your stories and your approved headlines; the perspective artifact is derived at the next node.\n",
      "consumes": [
        "counseling_goal"
      ],
      "invalidates": [
        "perspective"
      ],
      "elicit": {
        "persona": "Quiet, unhurried, and steady. This topic deserves the most care of the\nwhole interview. Ask one question at a time, receive each story without\ncommentary, and never rush the user.\n",
        "guardrails": [
          "This is the most personal question of the interview. Before the first story, remind the user once that they can skip or pause at any time and that skipping is completely fine.",
          "If a painful or traumatic memory surfaces, acknowledge it with warmth and care, do not probe deeper into the pain, and remind the user they choose whether to continue, move to a different memory, or skip.",
          "If the user expresses acute distress or mentions self-harm, respond with care, provide crisis resources, and pause the interview.",
          "Never interpret, analyze, or connect memories to the user's career during the conversation. Collect the stories only.",
          "Whatever the user recalls counts \u2014 fragments, images, and uncertain memories are all valid. Never question accuracy."
        ],
        "stages": [
          {
            "id": "stories",
            "goal": "Three early recollections, each with the feeling the user experienced in it.",
            "opening": "What are your earliest recollections? I'm interested in hearing three stories about things you recall happening to you when you were about three to six years old \u2014 or as early as you can remember.\n",
            "opening_i18n": {
              "ru": "\u041A\u0430\u043A\u0438\u0435 \u0442\u0432\u043E\u0438 \u0441\u0430\u043C\u044B\u0435 \u0440\u0430\u043D\u043D\u0438\u0435 \u0432\u043E\u0441\u043F\u043E\u043C\u0438\u043D\u0430\u043D\u0438\u044F? \u041C\u043D\u0435 \u0438\u043D\u0442\u0435\u0440\u0435\u0441\u043D\u043E \u0443\u0441\u043B\u044B\u0448\u0430\u0442\u044C \u0442\u0440\u0438 \u0438\u0441\u0442\u043E\u0440\u0438\u0438 \u043E \u0442\u043E\u043C, \u0447\u0442\u043E \u0441\u043B\u0443\u0447\u0430\u043B\u043E\u0441\u044C \u0441 \u0442\u043E\u0431\u043E\u0439 \u043B\u0435\u0442 \u0432 \u0442\u0440\u0438\u2013\u0448\u0435\u0441\u0442\u044C \u2014 \u0438\u043B\u0438 \u0442\u0430\u043A \u0440\u0430\u043D\u043E, \u043A\u0430\u043A \u0442\u044B \u0442\u043E\u043B\u044C\u043A\u043E \u043C\u043E\u0436\u0435\u0448\u044C \u0432\u0441\u043F\u043E\u043C\u043D\u0438\u0442\u044C.\n"
            },
            "probes": [
              {
                "when": "only a fragment or image comes",
                "then": "Welcome it \u2014 ask them to describe the scene as they see it."
              },
              {
                "when": "a story has been told without a feeling",
                "then": "Ask what feeling they experienced when that happened."
              },
              {
                "when": "fewer than three stories have been told",
                "then": "Ask gently what else they recall from those early years."
              },
              {
                "when": "the user hesitates or goes quiet",
                "then": "Give them room \u2014 offer that they can take their time, move to a different memory, or skip."
              }
            ],
            "done_when": [
              "Three early recollections have been told.",
              "Each recollection has a feeling named by the user."
            ]
          },
          {
            "id": "headlines",
            "goal": "A user-approved headline containing a verb, for each of the three stories.",
            "opening": "Let's give each story a headline \u2014 as if it appeared in tomorrow's newspaper. What headline captures the first one? Try to include a verb.\n",
            "probes": [
              {
                "when": "the user draws a blank",
                "then": "Offer two or three headline suggestions built only from their own words, and let them adjust until one feels right."
              },
              {
                "when": "a headline has no verb",
                "then": "Note that a headline gets its energy from a verb, and ask them to work one in."
              },
              {
                "when": "a headline is settled",
                "then": "Move to the next story's headline."
              }
            ],
            "done_when": [
              "Each of the three stories has a headline the user approved.",
              "Each headline contains a verb."
            ]
          }
        ]
      },
      "induce": {
        "steps": [
          {
            "id": "extract",
            "task": "Structure the three recollections in the order told, with the feeling, the approved headline, and the headline's main verb for each.\n",
            "model_tier": "small",
            "output_schema": {
              "type": "object",
              "required": [
                "recollections"
              ],
              "properties": {
                "recollections": {
                  "type": "array",
                  "minItems": 3,
                  "maxItems": 3,
                  "items": {
                    "type": "object",
                    "required": [
                      "order",
                      "scene_phrases",
                      "feeling",
                      "headline",
                      "headline_verb"
                    ],
                    "properties": {
                      "order": {
                        "type": "integer"
                      },
                      "scene_phrases": {
                        "type": "array",
                        "minItems": 1,
                        "items": {
                          "type": "string",
                          "x-verbatim": true
                        },
                        "description": "The load-bearing phrases of the story as told."
                      },
                      "feeling": {
                        "type": "string",
                        "x-verbatim": true
                      },
                      "headline": {
                        "type": "string",
                        "description": "The wording the user approved in conversation (it may have been co-authored, so it is not checked against the user's turns alone)."
                      },
                      "headline_verb": {
                        "type": "string"
                      }
                    }
                  }
                }
              }
            },
            "validation": [
              "Each headline must be exactly the wording the user approved, and must contain a verb."
            ]
          },
          {
            "id": "salience",
            "task": "Record the first verb of the first recollection as told, and note in one sentence whether the three stories read as problem, then intensification, then resolution \u2014 or another order. No interpretation beyond that single observation.\n",
            "model_tier": "small",
            "output_schema": {
              "type": "object",
              "required": [
                "first_verb_of_first_story",
                "sequence_reading"
              ],
              "properties": {
                "first_verb_of_first_story": {
                  "type": "string",
                  "x-verbatim": true
                },
                "sequence_reading": {
                  "type": "string"
                }
              }
            }
          }
        ]
      },
      "confirm": {
        "present": "structured_review",
        "authorize_language": "These are your stories and your headlines, organized \u2014 nothing has been interpreted. Change anything that doesn't match how you told it. Your perspective artifact will be drawn only from what you approve here, and you can revisit or remove this material at any time.\n"
      },
      "artifact": {
        "schema": {
          "type": "object",
          "required": [
            "recollections",
            "first_verb_of_first_story"
          ],
          "properties": {
            "recollections": {
              "type": "array"
            },
            "first_verb_of_first_story": {
              "type": "string"
            },
            "sequence_reading": {
              "type": "string"
            }
          }
        },
        "render": "{{#each recollections}}{{order}}. \u201C{{headline}}\u201D \u2014 {{feeling}}\n{{/each}}\n"
      }
    },
    "favorite_media": {
      "id": "favorite_media",
      "version": "0.1.0",
      "kind": "conversation",
      "sector": "interview",
      "title": "Favorite media",
      "purpose": "You'll talk about two or three shows, sites, or magazines you keep returning to. The premise, from career construction theory: your favorite media are vicarious environments \u2014 they reveal the kinds of places, people, and problems you like to be around, which is far more trustworthy than any interest inventory. This step records your favorites and what attracts you to them, in your words. The preferred-settings artifact is derived at the next node.\n",
      "consumes": [
        "counseling_goal"
      ],
      "invalidates": [
        "preferred_settings"
      ],
      "elicit": {
        "persona": "Warm, easy curiosity \u2014 this is the lightest topic of the interview. Use the\nlanguage of interests: what do you like, enjoy, what attracts you, what do\nyou prefer. One question at a time.\n",
        "guardrails": [
          "Never judge or rank the user's taste; a soap opera reveals as much as a documentary.",
          "Never suggest what might attract the user to something \u2014 the attraction must be stated in their words.",
          "Do not interpret or classify anything during the conversation; collect only."
        ],
        "stages": [
          {
            "id": "collect",
            "goal": "Two or three favorite media the user returns to regularly.",
            "opening": "Do you watch any television programs regularly? Which ones?\n",
            "opening_i18n": {
              "ru": "\u0415\u0441\u0442\u044C \u043B\u0438 \u043F\u0435\u0440\u0435\u0434\u0430\u0447\u0438 \u0438\u043B\u0438 \u0441\u0435\u0440\u0438\u0430\u043B\u044B, \u043A\u043E\u0442\u043E\u0440\u044B\u0435 \u0442\u044B \u0440\u0435\u0433\u0443\u043B\u044F\u0440\u043D\u043E \u0441\u043C\u043E\u0442\u0440\u0438\u0448\u044C? \u041A\u0430\u043A\u0438\u0435?\n"
            },
            "probes": [
              {
                "when": "the user rarely watches television",
                "then": "Ask which websites they visit again and again."
              },
              {
                "when": "websites also draw a blank",
                "then": "Ask about magazines or podcasts they follow."
              },
              {
                "when": "only one favorite has been named",
                "then": "Ask for one or two more."
              }
            ],
            "done_when": [
              "The user has named two or three regular favorites."
            ]
          },
          {
            "id": "attractions",
            "goal": "What specifically attracts the user to each favorite.",
            "opening": "What do you like about {{item}}? What attracts you to it?\n",
            "probes": [
              {
                "when": "the user names a general-interest magazine or site",
                "then": "Ask which section they read first."
              },
              {
                "when": `the answer is vague ("it's fun", "it's good")`,
                "then": "Ask what specifically they enjoy most about it."
              },
              {
                "when": "the user only summarizes the plot",
                "then": "Ask what it is about the world of that show they enjoy spending time in."
              }
            ],
            "done_when": [
              "Each named favorite has at least one attraction stated in the user's own words."
            ]
          }
        ]
      },
      "induce": {
        "steps": [
          {
            "id": "extract",
            "task": "Structure the favorites with their attractions in the order named.",
            "model_tier": "small",
            "output_schema": {
              "type": "object",
              "required": [
                "media"
              ],
              "properties": {
                "media": {
                  "type": "array",
                  "minItems": 2,
                  "items": {
                    "type": "object",
                    "required": [
                      "title",
                      "medium",
                      "attractions",
                      "named_order"
                    ],
                    "properties": {
                      "title": {
                        "type": "string"
                      },
                      "medium": {
                        "type": "string",
                        "enum": [
                          "tv",
                          "website",
                          "magazine",
                          "podcast",
                          "other"
                        ]
                      },
                      "attractions": {
                        "type": "array",
                        "minItems": 1,
                        "items": {
                          "type": "string",
                          "x-verbatim": true
                        }
                      },
                      "named_order": {
                        "type": "integer"
                      }
                    }
                  }
                }
              }
            }
          },
          {
            "id": "riasec",
            "task": "Classify each favorite into the RIASEC taxonomy using only the book's definitions: R Realistic (mechanical, outdoor, making and repairing), I Investigative (scientific, analytic, solving mysteries), A Artistic (creative, aesthetic, performing), S Social (caring, conversational, educational), E Enterprising (managerial, political, persuasive), C Conventional (office, organizing, systematized). Reference examples: This Old House is R, CSI is I, America's Got Talent is A, Friends is S, Shark Tank is E, Martha Stewart is C. Base each code on the user's stated attraction, not on the title alone.\n",
            "model_tier": "small",
            "output_schema": {
              "type": "object",
              "required": [
                "classified",
                "overall_codes"
              ],
              "properties": {
                "classified": {
                  "type": "array",
                  "items": {
                    "type": "object",
                    "required": [
                      "title",
                      "code",
                      "rationale"
                    ],
                    "properties": {
                      "title": {
                        "type": "string"
                      },
                      "code": {
                        "type": "string",
                        "enum": [
                          "R",
                          "I",
                          "A",
                          "S",
                          "E",
                          "C"
                        ]
                      },
                      "rationale": {
                        "type": "string"
                      }
                    }
                  }
                },
                "overall_codes": {
                  "type": "array",
                  "minItems": 1,
                  "maxItems": 3,
                  "items": {
                    "type": "string",
                    "enum": [
                      "R",
                      "I",
                      "A",
                      "S",
                      "E",
                      "C"
                    ]
                  }
                }
              }
            }
          }
        ]
      },
      "confirm": {
        "present": "structured_review",
        "authorize_language": "These are your favorites and your words for what attracts you, plus a first rough setting code. Fix anything that feels off \u2014 your preferred-settings artifact will be built only from what you approve here.\n"
      },
      "artifact": {
        "schema": {
          "type": "object",
          "required": [
            "media",
            "classified",
            "overall_codes"
          ],
          "properties": {
            "media": {
              "type": "array"
            },
            "classified": {
              "type": "array"
            },
            "overall_codes": {
              "type": "array"
            }
          }
        },
        "render": "{{#each media}}\u2022 {{title}} ({{medium}}): {{#each attractions}}{{this}}; {{/each}}{{/each}}\nCodes: {{overall_codes}}\n"
      }
    },
    "favorite_story": {
      "id": "favorite_story",
      "version": "0.1.0",
      "kind": "conversation",
      "sector": "interview",
      "title": "Favorite story",
      "purpose": "You'll name your current favorite story from a book or movie and retell it in your own words. The premise, from career construction theory: the story you are drawn to right now usually carries the script for the next chapter of your own life \u2014 how a character like you deals with a predicament like yours. Your retelling is what matters, not the official plot. This step only records your version; the script artifact is derived at the next node.\n",
      "consumes": [
        "counseling_goal"
      ],
      "invalidates": [
        "script"
      ],
      "elicit": {
        "persona": "Attentive, story-loving curiosity. You want the user's version of the tale \u2014\nthe details they keep, the ones they drop, the words they choose. One\nquestion at a time.\n",
        "guardrails": [
          "It must be the user's CURRENT favorite, not their all-time favorite \u2014 an all-time favorite usually points to a role model instead of a script.",
          "Always have the user tell the story in their own words, even if it is world-famous. Never fill in plot details for them.",
          "Do not interpret the story or connect it to their life yourself; if a bridge question is asked, the user draws the connection or declines."
        ],
        "stages": [
          {
            "id": "name",
            "goal": "One current favorite story from a book or movie.",
            "opening": "Currently, what is your favorite story from a book or movie?\n",
            "opening_i18n": {
              "ru": "\u041A\u0430\u043A\u0430\u044F \u0438\u0441\u0442\u043E\u0440\u0438\u044F \u0438\u0437 \u043A\u043D\u0438\u0433\u0438 \u0438\u043B\u0438 \u0444\u0438\u043B\u044C\u043C\u0430 \u2014 \u0442\u0432\u043E\u044F \u043B\u044E\u0431\u0438\u043C\u0430\u044F \u0441\u0435\u0439\u0447\u0430\u0441?\n"
            },
            "probes": [
              {
                "when": "the user offers an all-time favorite from childhood",
                "then": "Honor it, then ask what story has gripped them lately \u2014 something read or watched in the last year or two."
              },
              {
                "when": "the user cannot pick one",
                "then": "Ask what book or movie they last recommended to someone."
              }
            ],
            "done_when": [
              "The user has named one current favorite story."
            ]
          },
          {
            "id": "retell",
            "goal": "The story retold in the user's own words, with a protagonist and a predicament.",
            "opening": "Tell me the story \u2014 in your own words.\n",
            "probes": [
              {
                "when": 'the user says "you probably know it"',
                "then": "Say you want their version \u2014 the way they tell it is what matters here."
              },
              {
                "when": "the retelling is a one-liner",
                "then": "Ask what happens to the main character, and how it turns out."
              },
              {
                "when": "the retelling has no clear protagonist",
                "then": "Ask who the story is really about, for them."
              }
            ],
            "done_when": [
              "The story has been retold in the user's own words.",
              "A main character and the problem they face are identifiable from the user's telling."
            ]
          },
          {
            "id": "bridge",
            "goal": "An optional self-connection, offered once.",
            "opening": "Do you see any similarity between that story and your own situation right now?\n",
            "probes": [
              {
                "when": "the user declines or says no",
                "then": "Accept that fully and close the topic \u2014 no follow-up."
              }
            ],
            "done_when": [
              "The user has answered the bridge question once, in any way including declining."
            ]
          }
        ]
      },
      "induce": {
        "steps": [
          {
            "id": "extract",
            "task": "Structure the story exactly as the user told it.",
            "model_tier": "small",
            "output_schema": {
              "type": "object",
              "required": [
                "title",
                "medium",
                "protagonist",
                "predicament",
                "key_phrases",
                "similarity_to_self"
              ],
              "properties": {
                "title": {
                  "type": "string"
                },
                "medium": {
                  "type": "string",
                  "enum": [
                    "book",
                    "movie",
                    "tv",
                    "other"
                  ]
                },
                "protagonist": {
                  "type": "string",
                  "description": "The main character as the user framed them."
                },
                "predicament": {
                  "type": "string",
                  "description": "The central problem the character faces, per the user's telling."
                },
                "key_phrases": {
                  "type": "array",
                  "minItems": 2,
                  "items": {
                    "type": "string",
                    "x-verbatim": true
                  },
                  "description": "The load-bearing phrases of the user's retelling."
                },
                "similarity_to_self": {
                  "type": [
                    "string",
                    "null"
                  ],
                  "x-verbatim": true,
                  "description": "The user's own bridge to their situation; null if declined."
                }
              }
            }
          }
        ]
      },
      "confirm": {
        "present": "structured_review",
        "authorize_language": "This is your version of the story, structured. Fix anything that doesn't match how you told it \u2014 your script artifact will be built only from what you approve here.\n"
      },
      "artifact": {
        "schema": {
          "type": "object",
          "required": [
            "title",
            "protagonist",
            "predicament",
            "key_phrases"
          ],
          "properties": {
            "title": {
              "type": "string"
            },
            "medium": {
              "type": "string"
            },
            "protagonist": {
              "type": "string"
            },
            "predicament": {
              "type": "string"
            },
            "key_phrases": {
              "type": "array",
              "items": {
                "type": "string"
              }
            },
            "similarity_to_self": {
              "type": [
                "string",
                "null"
              ]
            }
          }
        },
        "render": "{{title}} \u2014 {{protagonist}}: {{predicament}}\n"
      }
    },
    "identity_statement": {
      "id": "identity_statement",
      "version": "0.1.0",
      "kind": "derived",
      "sector": "portrait",
      "title": "Identity statement",
      "purpose": 'Distills your life portrait into one sentence you can carry \u2014 your success formula. The premise, from career construction theory: the future is already embedded in it. The classic template is "I will be happy and successful when I\u2026", assembled from phrases of your own portrait. Several candidate formulas are drafted; you pick one, reword it, or write your own \u2014 the sentence must be one you would actually say.\n',
      "consumes": [
        "life_portrait",
        "counseling_goal"
      ],
      "invalidates": [
        "action_recipe"
      ],
      "induce": {
        "steps": [
          {
            "id": "assemble",
            "task": `From the authorized life portrait, assemble two or three alternative success formulas \u2014 single first-person sentences following the shape "I will be happy and successful when I \u2026" (adapt the template naturally to the session language and to how the user speaks about themselves). Build each from the portrait's own phrases: the strongest candidates borrow the user's verbs. Each candidate should carry the career theme and point the plot forward; together they should offer a real choice of emphasis, not three wordings of one sentence.
`,
            "model_tier": "small",
            "output_schema": {
              "type": "object",
              "required": [
                "candidates",
                "source_phrases"
              ],
              "properties": {
                "candidates": {
                  "type": "array",
                  "x-candidates": true,
                  "minItems": 2,
                  "maxItems": 3,
                  "items": {
                    "type": "string"
                  }
                },
                "source_phrases": {
                  "type": "array",
                  "items": {
                    "type": "string",
                    "x-verbatim": true
                  },
                  "description": "The portrait phrases the formulas were assembled from."
                }
              }
            }
          }
        ]
      },
      "confirm": {
        "present": "candidates",
        "choice_field": "statement",
        "authorize_language": "This sentence is your compass \u2014 you'll reach for it at every confusing choice. Your action plan is built to serve it.\n"
      },
      "artifact": {
        "schema": {
          "type": "object",
          "required": [
            "statement"
          ],
          "properties": {
            "statement": {
              "type": "string"
            },
            "source_phrases": {
              "type": "array",
              "items": {
                "type": "string"
              }
            }
          }
        },
        "render": "{{statement}}\n"
      }
    },
    "life_portrait": {
      "id": "life_portrait",
      "version": "0.1.0",
      "kind": "derived",
      "sector": "portrait",
      "title": "Life portrait",
      "purpose": "Assembles everything you authorized into one large story \u2014 the life portrait. The premise, from career construction theory: the small stories you told hold together as a macronarrative with six movements, presented in a fixed order: the perspective you keep returning to, the self you built to meet it, the settings that hold you, the script you are drawn to enact, the advice you already carry, and a future scenario that answers the very request you opened with. It is written from your own words and metaphors, bends the arc hopefully without flattering, and is provisional until you authorize it \u2014 you are the author; this is a draft for your editing.\n",
      "consumes": [
        "perspective",
        "character_sketch",
        "preferred_settings",
        "script",
        "advice_to_self",
        "counseling_goal"
      ],
      "invalidates": [
        "identity_statement",
        "action_recipe"
      ],
      "induce": {
        "steps": [
          {
            "id": "compose",
            "task": `Compose the life portrait from the authorized artifacts, in six titled movements of a few sentences each, second person throughout, then join them into one continuous portrait text. Movement 1 \u2014 perspective: the "one damn thing" the user faces again and again, opened with feeling. Movement 2 \u2014 self: the character built to meet it, quoting the user's admired descriptor words; show, don't tell. Movement 3 \u2014 setting: the places, people, problems, and procedures that hold this self. Movement 4 \u2014 script: the storyline that unites self and setting, keeping the transformative scene visible. Movement 5 \u2014 advice: the user's motto as the direction the author-self gives the actor-self, quoted exactly. Movement 6 \u2014 future scenario: restate the user's original request, then answer it \u2014 how the career theme extends the plot in a fitting direction, turning preoccupation toward occupation. Rules: use the user's words and metaphors wherever they exist; keep tensions visible rather than smoothing them; bend the arc hopefully but never flatter; no psychological jargon, no diagnosis; the passive must turn active by the end.
`,
            "model_tier": "large",
            "output_schema": {
              "type": "object",
              "required": [
                "movements",
                "full_portrait",
                "key_quotes"
              ],
              "properties": {
                "movements": {
                  "type": "array",
                  "minItems": 6,
                  "maxItems": 6,
                  "items": {
                    "type": "object",
                    "required": [
                      "title",
                      "text"
                    ],
                    "properties": {
                      "title": {
                        "type": "string"
                      },
                      "text": {
                        "type": "string"
                      }
                    }
                  }
                },
                "full_portrait": {
                  "type": "string",
                  "description": "The six movements joined into one continuous second-person portrait."
                },
                "key_quotes": {
                  "type": "array",
                  "items": {
                    "type": "string",
                    "x-verbatim": true
                  },
                  "description": "The user's own load-bearing words woven into the portrait."
                }
              }
            }
          }
        ]
      },
      "confirm": {
        "present": "structured_review",
        "authorize_language": "This is a provisional portrait \u2014 you are its author, and it only becomes true when you say so. Rewrite freely; your success formula and action plan grow from what you approve here. Once authorized, you'll also be asked whether your original request still stands or deserves amending.\n"
      },
      "artifact": {
        "schema": {
          "type": "object",
          "required": [
            "movements",
            "full_portrait"
          ],
          "properties": {
            "movements": {
              "type": "array"
            },
            "full_portrait": {
              "type": "string"
            },
            "key_quotes": {
              "type": "array",
              "items": {
                "type": "string"
              }
            }
          }
        },
        "render": "{{full_portrait}}\n"
      },
      "gate": "all"
    },
    "motto": {
      "id": "motto",
      "version": "0.1.0",
      "kind": "conversation",
      "sector": "interview",
      "title": "Motto",
      "purpose": "You'll share your favorite saying or motto. The premise, from career construction theory: a motto is the best advice you have for yourself \u2014 condensed practical wisdom that usually states, almost verbatim, your own strategy for moving to the next chapter. At the very end of the whole journey, your motto is handed back to you. This step just records it; the advice-to-self artifact is derived at the next node.\n",
      "consumes": [
        "counseling_goal"
      ],
      "invalidates": [
        "advice_to_self"
      ],
      "elicit": {
        "persona": "Light and appreciative \u2014 this is a short topic. People often smile at this\nquestion; let them. One question at a time.\n",
        "guardrails": [
          "Any saying counts \u2014 proverb, song lyric, family phrase, something a coach once said. Never rate or improve it.",
          "If the user has no motto, composing one right now is fully valid \u2014 the book treats a saying created in the moment as equally revealing.",
          "Do not interpret the motto during the conversation; collect only."
        ],
        "stages": [
          {
            "id": "elicit",
            "goal": "One favorite saying or motto, in the user's exact wording.",
            "opening": "Tell me your favorite saying or motto.\n",
            "opening_i18n": {
              "ru": "\u041D\u0430\u0437\u043E\u0432\u0438 \u0441\u0432\u043E\u044E \u043B\u044E\u0431\u0438\u043C\u0443\u044E \u043F\u043E\u0433\u043E\u0432\u043E\u0440\u043A\u0443 \u0438\u043B\u0438 \u0434\u0435\u0432\u0438\u0437.\n"
            },
            "probes": [
              {
                "when": "the user cannot think of one",
                "then": "Ask about a saying they remember hearing that stuck with them."
              },
              {
                "when": "still nothing comes",
                "then": "Invite them to make one up right now \u2014 the advice they would put on a card for themselves at this moment in their life."
              },
              {
                "when": "several sayings are offered",
                "then": "Ask which one they would keep if they could keep only one."
              }
            ],
            "done_when": [
              "The user has stated one saying or motto."
            ]
          },
          {
            "id": "anchor",
            "goal": "A touch of origin or context, asked once.",
            "opening": "Where does that one come from \u2014 or when does it usually come to mind?\n",
            "done_when": [
              "The user has answered once, in any way."
            ]
          }
        ]
      },
      "induce": {
        "steps": [
          {
            "id": "extract",
            "task": "Record the motto exactly as stated, with its origin if given.",
            "model_tier": "small",
            "output_schema": {
              "type": "object",
              "required": [
                "motto",
                "origin",
                "when_it_surfaces"
              ],
              "properties": {
                "motto": {
                  "type": "string",
                  "x-verbatim": true
                },
                "origin": {
                  "type": [
                    "string",
                    "null"
                  ],
                  "x-verbatim": true,
                  "description": "Where the saying comes from, in the user's words; null if not shared."
                },
                "when_it_surfaces": {
                  "type": [
                    "string",
                    "null"
                  ],
                  "x-verbatim": true,
                  "description": "When it comes to mind, in the user's words; null if not shared."
                }
              }
            }
          }
        ]
      },
      "confirm": {
        "present": "structured_review",
        "authorize_language": "This is your saying, word for word. Correct it if even one word is off \u2014 it will be repeated back to you at the end of the journey, so it should be exactly yours.\n"
      },
      "artifact": {
        "schema": {
          "type": "object",
          "required": [
            "motto"
          ],
          "properties": {
            "motto": {
              "type": "string"
            },
            "origin": {
              "type": [
                "string",
                "null"
              ]
            },
            "when_it_surfaces": {
              "type": [
                "string",
                "null"
              ]
            }
          }
        },
        "render": "\u201C{{motto}}\u201D\n"
      }
    },
    "perspective": {
      "id": "perspective",
      "version": "0.1.0",
      "kind": "derived",
      "sector": "induction",
      "title": "Perspective",
      "purpose": "Reads your early recollections as parables about today. The premise, from career construction theory: early memories are not history \u2014 they reveal the vantage point from which you view your current transition, and often the preoccupation your life keeps answering. The first story tends to be a pr\xE9cis of the present problem; the sequence often moves from problem toward resolution; your own headlines carry the leitmotifs. If you skipped early recollections, the preoccupation is inferred from your role models instead \u2014 admired courage implies familiar fear. Nothing here is a verdict: you edit and authorize every word.\n",
      "consumes": [
        "early_recollections",
        "role_models",
        "counseling_goal"
      ],
      "invalidates": [
        "character_sketch",
        "life_portrait"
      ],
      "induce": {
        "steps": [
          {
            "id": "read",
            "task": "Compose the user's perspective on their current transition from the early_recollections artifact. Treat the first recollection as a possible pr\xE9cis of the present problem stated in the counseling goal; weigh the first verb heavily; read the three stories as a sequence (often problem, intensification, resolution \u2014 note if the order differs); use the user's own headlines as leitmotifs and quote them exactly. Address the user in the second person. If early_recollections is absent, infer the preoccupation from the role models instead: the admired characteristics are solutions, so name the problem they solve (bravery implies fear, independence implies dependence). Never diagnose; frame everything as a perspective the user may recognize \u2014 or correct.\n",
            "model_tier": "large",
            "output_schema": {
              "type": "object",
              "required": [
                "perspective_statement",
                "preoccupation",
                "first_story_reading",
                "leitmotifs"
              ],
              "properties": {
                "perspective_statement": {
                  "type": "string",
                  "description": "Two to five second-person sentences \u2014 the vantage point from which the user views the current transition."
                },
                "preoccupation": {
                  "type": "string",
                  "description": "The recurring concern at the base of the character arc, named gently."
                },
                "first_story_reading": {
                  "type": [
                    "string",
                    "null"
                  ],
                  "description": "How the first recollection frames the present problem; null when derived from role models."
                },
                "leitmotifs": {
                  "type": "array",
                  "items": {
                    "type": "string",
                    "x-verbatim": true
                  },
                  "description": "The user's own headline words or recurring phrases."
                }
              }
            }
          }
        ]
      },
      "confirm": {
        "present": "structured_review",
        "authorize_language": "This is a perspective, not a verdict \u2014 reword anything that doesn't feel like your own view. Your character sketch and life portrait build on what you approve here.\n"
      },
      "artifact": {
        "schema": {
          "type": "object",
          "required": [
            "perspective_statement",
            "preoccupation"
          ],
          "properties": {
            "perspective_statement": {
              "type": "string"
            },
            "preoccupation": {
              "type": "string"
            },
            "first_story_reading": {
              "type": [
                "string",
                "null"
              ]
            },
            "leitmotifs": {
              "type": "array",
              "items": {
                "type": "string"
              }
            }
          }
        },
        "render": "{{perspective_statement}}\n"
      }
    },
    "preferred_settings": {
      "id": "preferred_settings",
      "version": "0.1.0",
      "kind": "derived",
      "sector": "induction",
      "title": "Preferred settings",
      "purpose": "Turns your favorite media into a picture of where you like to be. The premise, from career construction theory: favorite shows, sites, and magazines are vicarious environments \u2014 trustworthy evidence of the settings you seek. They are analyzed along four dimensions: places, people, problems, and procedures, and summarized in the Holland (RIASEC) vocabulary. This is a description of attraction, not a prescription of jobs \u2014 occupations come later, and you authorize everything.\n",
      "consumes": [
        "favorite_media",
        "counseling_goal"
      ],
      "invalidates": [
        "script",
        "life_portrait"
      ],
      "induce": {
        "steps": [
          {
            "id": "analyze",
            "task": "From the favorite_media artifact, describe the user's preferred occupational settings along the book's four dimensions \u2014 the places they want to be in, the people they want around them, the problems they prefer to address, and the procedures they like to use. Ground every dimension in the user's stated attractions and quote their words where they carry the meaning. Confirm or refine the RIASEC codes from the media artifact, basing each code on the stated attraction rather than the title. Close with a short second-person niche statement \u2014 the kind of stage on which this user can perform themselves.\n",
            "model_tier": "small",
            "output_schema": {
              "type": "object",
              "required": [
                "places",
                "people",
                "problems",
                "procedures",
                "riasec",
                "niche_statement"
              ],
              "properties": {
                "places": {
                  "type": "string"
                },
                "people": {
                  "type": "string"
                },
                "problems": {
                  "type": "string"
                },
                "procedures": {
                  "type": "string"
                },
                "riasec": {
                  "type": "object",
                  "required": [
                    "codes",
                    "rationale"
                  ],
                  "properties": {
                    "codes": {
                      "type": "array",
                      "minItems": 1,
                      "maxItems": 3,
                      "items": {
                        "type": "string",
                        "enum": [
                          "R",
                          "I",
                          "A",
                          "S",
                          "E",
                          "C"
                        ]
                      }
                    },
                    "rationale": {
                      "type": "string"
                    }
                  }
                },
                "niche_statement": {
                  "type": "string",
                  "description": "Two or three second-person sentences describing the setting that would hold this user well."
                },
                "evidence": {
                  "type": "array",
                  "items": {
                    "type": "string",
                    "x-verbatim": true
                  },
                  "description": "The user's own attraction phrases that carry this reading."
                }
              }
            }
          }
        ]
      },
      "confirm": {
        "present": "structured_review",
        "authorize_language": "This describes where you're drawn, in your own evidence \u2014 correct anything that doesn't ring true. Your script and life portrait build on what you approve here.\n"
      },
      "artifact": {
        "schema": {
          "type": "object",
          "required": [
            "places",
            "people",
            "problems",
            "procedures",
            "riasec",
            "niche_statement"
          ],
          "properties": {
            "places": {
              "type": "string"
            },
            "people": {
              "type": "string"
            },
            "problems": {
              "type": "string"
            },
            "procedures": {
              "type": "string"
            },
            "riasec": {
              "type": "object"
            },
            "niche_statement": {
              "type": "string"
            },
            "evidence": {
              "type": "array",
              "items": {
                "type": "string"
              }
            }
          }
        },
        "render": "{{niche_statement}}\n"
      }
    },
    "role_models": {
      "id": "role_models",
      "version": "0.1.0",
      "kind": "conversation",
      "sector": "interview",
      "title": "Role models",
      "purpose": "You'll talk about three figures you admired when you were around six years old. The premise, from career construction theory: the traits you say you admired are the blueprint you used to build yourself \u2014 it is what you admired, not whom, that matters. This step only records and organizes your own words. The character sketch is drafted at the next node, from what you approve here, and shown for your approval too.\n",
      "consumes": [
        "counseling_goal"
      ],
      "invalidates": [
        "character_sketch"
      ],
      "elicit": {
        "persona": "You are a career construction interviewer. Warm, playful curiosity; one\nquestion at a time. You care about what the user admired, never about whom.\nYour follow-ups voice inferences, not interpretations \u2014 thought-provoking,\noccasionally humorous, always offered so the user can correct them.\n",
        "guardrails": [
          "Never suggest characteristics or admire-worthy traits yourself. Every descriptor must originate from the user.",
          'Never assume what a famous figure "obviously" stands for. One person admires Superman for truth and justice; another admired only his invisible airplane. Always ask what specifically this user admired.',
          "Fictional characters, cartoon figures, and animal characters are fully valid role models \u2014 welcome them without surprise.",
          "Parents named as models are recorded as guides, not models. Honor the parent, then ask for someone besides their parents. If the user expresses a collectivist orientation where family expectations weigh heavily, note parental influences with extra care rather than pushing past them.",
          "If a painful memory surfaces, acknowledge it with care, do not probe it here, and remind the user they can skip or pause at any time."
        ],
        "stages": [
          {
            "id": "collect",
            "goal": "Three admired figures from around age six, none of them parents.",
            "opening": "Who did you admire when you were about six years old? Tell me about her or him.\n",
            "opening_i18n": {
              "ru": "\u041A\u0442\u043E \u0431\u044B\u043B \u0442\u0432\u043E\u0438\u043C \u043A\u0443\u043C\u0438\u0440\u043E\u043C, \u043A\u043E\u0433\u0434\u0430 \u0442\u0435\u0431\u0435 \u0431\u044B\u043B\u043E \u043B\u0435\u0442 \u0448\u0435\u0441\u0442\u044C? \u0420\u0430\u0441\u0441\u043A\u0430\u0436\u0438 \u043C\u043D\u0435 \u043E \u043D\u0451\u043C \u2014 \u0438\u043B\u0438 \u043E \u043D\u0435\u0439.\n"
            },
            "probes": [
              {
                "when": "the user can't think of anyone",
                "then": "Suggest the model need not be famous \u2014 a relative, neighbor, teacher, or a character from a book, cartoon, or show all count."
              },
              {
                "when": "the user names a parent",
                "then": "Ask what the parent was like and record those qualities as guide descriptors, then ask whom they admired besides their parents."
              },
              {
                "when": "fewer than three models have been named",
                "then": 'Ask for another \u2014 "Who else did you admire back then?"'
              }
            ],
            "done_when": [
              "Three non-parent models have been named."
            ]
          },
          {
            "id": "describe",
            "goal": "At least two descriptor phrases per model, as seen through childhood eyes.",
            "opening": "Describe {{model}} to me. Just tell me about them as you viewed them back then \u2014 what were they like?\n",
            "probes": [
              {
                "when": "the user describes what the model did (actions, plot, feats)",
                "then": "Ask what the model was like \u2014 their characteristics."
              },
              {
                "when": "the user describes the model as they see them today",
                "then": "Ask how they viewed the model when they were young, and what first drew them to the model."
              },
              {
                "when": "descriptors stay sparse after asking",
                "then": "Ask what specifically they admired about this one."
              },
              {
                "when": "a descriptor invites an obvious inference",
                "then": 'Offer it as a playful question they can correct \u2014 someone who admires Zorro might be asked, "Do you mask your true identity? Do you seek to right wrongs?"'
              }
            ],
            "done_when": [
              "Each of the three models has at least two descriptor phrases."
            ]
          },
          {
            "id": "compare",
            "goal": "Similarities and differences between the user and each model.",
            "opening": "How are you similar to {{model}} \u2014 and how are you different?\n",
            "probes": [
              {
                "when": "all three models have been compared",
                "then": "Optionally ask what all three have in common."
              }
            ],
            "done_when": [
              "A similarity or difference has been noted for each model."
            ]
          }
        ]
      },
      "induce": {
        "steps": [
          {
            "id": "extract",
            "task": "Structure the models and guides with descriptors in the order spoken.",
            "model_tier": "small",
            "output_schema": {
              "type": "object",
              "required": [
                "models"
              ],
              "properties": {
                "models": {
                  "type": "array",
                  "minItems": 3,
                  "maxItems": 3,
                  "items": {
                    "type": "object",
                    "required": [
                      "name",
                      "named_order",
                      "descriptors"
                    ],
                    "properties": {
                      "name": {
                        "type": "string"
                      },
                      "named_order": {
                        "type": "integer"
                      },
                      "descriptors": {
                        "type": "array",
                        "minItems": 2,
                        "items": {
                          "type": "object",
                          "properties": {
                            "text": {
                              "type": "string",
                              "x-verbatim": true
                            },
                            "spoken_order": {
                              "type": "integer"
                            }
                          }
                        }
                      },
                      "similarities": {
                        "type": "array",
                        "items": {
                          "type": "string",
                          "x-verbatim": true
                        }
                      },
                      "differences": {
                        "type": "array",
                        "items": {
                          "type": "string",
                          "x-verbatim": true
                        }
                      }
                    }
                  }
                },
                "guides": {
                  "type": "array",
                  "items": {
                    "type": "object",
                    "properties": {
                      "name": {
                        "type": "string"
                      },
                      "relationship": {
                        "type": "string"
                      },
                      "descriptors": {
                        "type": "array",
                        "items": {
                          "type": "string",
                          "x-verbatim": true
                        }
                      }
                    }
                  }
                },
                "shared_by_all": {
                  "type": [
                    "string",
                    "null"
                  ],
                  "x-verbatim": true,
                  "description": "Null if the user was not asked or had no answer."
                }
              }
            }
          },
          {
            "id": "salience",
            "task": "Mark salient self-conceptions by primacy and repetition. Primacy: the first descriptor of the first-named model. Repetition: descriptors repeated or closely echoed across models.\n",
            "model_tier": "small",
            "output_schema": {
              "type": "object",
              "required": [
                "primacy_trait",
                "repeated_traits"
              ],
              "properties": {
                "primacy_trait": {
                  "type": "string",
                  "x-verbatim": true
                },
                "repeated_traits": {
                  "type": "array",
                  "items": {
                    "type": "object",
                    "properties": {
                      "trait": {
                        "type": "string"
                      },
                      "echoes": {
                        "type": "array",
                        "minItems": 2,
                        "items": {
                          "type": "string",
                          "x-verbatim": true
                        }
                      }
                    }
                  }
                }
              }
            },
            "validation": [
              "primacy_trait must equal the first spoken descriptor of the model with named_order 1.",
              "Each repeated_traits entry must cite echoes from at least two different models."
            ]
          }
        ]
      },
      "confirm": {
        "present": "structured_review",
        "authorize_language": "These are your words, organized. Fix anything that doesn't sound like you \u2014 your character sketch will be built only from what you approve here.\n"
      },
      "artifact": {
        "schema": {
          "type": "object",
          "required": [
            "models",
            "primacy_trait",
            "repeated_traits"
          ],
          "properties": {
            "models": {
              "type": "array"
            },
            "guides": {
              "type": "array"
            },
            "shared_by_all": {
              "type": "string"
            },
            "primacy_trait": {
              "type": "string"
            },
            "repeated_traits": {
              "type": "array"
            }
          }
        },
        "render": "{{#each models}}\u2022 {{name}}: {{#each descriptors}}{{text}}, {{/each}}{{/each}}\nFirst said: \u201C{{primacy_trait}}\u201D \u2014 repeated: {{#each repeated_traits}}{{trait}}; {{/each}}\n"
      }
    },
    "script": {
      "id": "script",
      "version": "0.1.0",
      "kind": "derived",
      "sector": "induction",
      "title": "Script",
      "purpose": "Finds the storyline in your favorite story. The premise, from career construction theory: your current favorite story carries the script for the next chapter \u2014 a character like you, facing a predicament like yours, and a way through it. The script unites your self (character sketch) with your setting (preferred settings). One duty of care from the book: favorite stories are cultural products, so any limiting assumptions hiding in the script are flagged for your own critical eye \u2014 the story is an invitation, never a prescription. You edit and authorize everything.\n",
      "consumes": [
        "favorite_story",
        "character_sketch",
        "preferred_settings",
        "counseling_goal"
      ],
      "invalidates": [
        "life_portrait"
      ],
      "induce": {
        "steps": [
          {
            "id": "compose",
            "task": "From the favorite_story artifact \u2014 as the user retold it, using their key phrases \u2014 articulate the script for the user's next chapter: how a self like theirs (character_sketch) meets a setting like theirs (preferred_settings) and moves through a predicament like the one in the story. Address the user in the second person. Name the transformative scene \u2014 the moment in their telling where the turn happens \u2014 and state the credo the story carries (the idea a life like this serves). Then, gently and briefly, note anything in the script that could confine rather than free the user (gender expectations, prescribed endings, borrowed obligations) as questions for the user to judge, not corrections. Trace how the script turns passive into active. Never invent plot the user did not tell.\n",
            "model_tier": "large",
            "output_schema": {
              "type": "object",
              "required": [
                "script_statement",
                "transformative_scene",
                "credo",
                "passive_to_active"
              ],
              "properties": {
                "script_statement": {
                  "type": "string",
                  "description": "Three to six second-person sentences \u2014 the storyline for the next chapter."
                },
                "transformative_scene": {
                  "type": "string"
                },
                "credo": {
                  "type": "string",
                  "description": "The idea served by a life following this script."
                },
                "passive_to_active": {
                  "type": "string",
                  "description": "One sentence \u2014 from being influenced by the problem to influencing it."
                },
                "deconstruction_notes": {
                  "type": [
                    "string",
                    "null"
                  ],
                  "description": "Possible confining assumptions in the story, framed as open questions; null if none stand out."
                },
                "story_phrases": {
                  "type": "array",
                  "items": {
                    "type": "string",
                    "x-verbatim": true
                  },
                  "description": "The user's own phrases from the retelling that carry the script."
                }
              }
            }
          }
        ]
      },
      "confirm": {
        "present": "structured_review",
        "authorize_language": "A script is an invitation, not a prescription \u2014 rewrite anything that doesn't feel like your storyline. The life portrait builds on what you approve here.\n"
      },
      "artifact": {
        "schema": {
          "type": "object",
          "required": [
            "script_statement",
            "transformative_scene",
            "credo"
          ],
          "properties": {
            "script_statement": {
              "type": "string"
            },
            "transformative_scene": {
              "type": "string"
            },
            "credo": {
              "type": "string"
            },
            "passive_to_active": {
              "type": "string"
            },
            "deconstruction_notes": {
              "type": [
                "string",
                "null"
              ]
            },
            "story_phrases": {
              "type": "array",
              "items": {
                "type": "string"
              }
            }
          }
        },
        "render": "{{script_statement}}\n"
      }
    }
  };

  // src/storage.ts
  function scoped(base, prefix) {
    if (!prefix) return base;
    const p = prefix.endsWith("/") ? prefix : `${prefix}/`;
    return {
      read: (path) => base.read(p + path),
      write: (path, data) => base.write(p + path, data),
      remove: (path) => base.remove(p + path),
      list: (path) => base.list(path ? p + path : p.slice(0, -1)),
      exists: (path) => base.exists(p + path)
    };
  }

  // src/map.ts
  var MAP_SECTORS = [
    { n: 1, label: "Phase 1 \xB7 Goal" },
    { n: 2, label: "Phase 2 \xB7 Interview" },
    { n: 3, label: "Phase 3 \xB7 Induction" },
    { n: 4, label: "Phase 4 \xB7 Portrait & intention" },
    { n: 5, label: "Phase 5 \xB7 Action" }
  ];
  var MAP_NODES = [
    {
      id: "counseling_goal",
      title: "Goal setting",
      sector: 1,
      kind: "conversation",
      desc: "State what you want from this process \u2014 it guides everything that follows.",
      hint: "\u21B3 guides every derived step \xB7 never your recorded interviews"
    },
    {
      id: "role_models",
      title: "Role models",
      sector: 2,
      kind: "conversation",
      desc: "Three figures you admired as a child \u2014 the blueprint you built yourself from."
    },
    {
      id: "favorite_media",
      title: "Favorite media",
      sector: 2,
      kind: "conversation",
      desc: "Two or three shows, sites, or magazines you keep returning to \u2014 your preferred settings."
    },
    {
      id: "favorite_story",
      title: "Favorite story",
      sector: 2,
      kind: "conversation",
      desc: "One story \u2014 your current favorite, retold in your words \u2014 the script for your next chapter."
    },
    {
      id: "motto",
      title: "Motto",
      sector: 2,
      kind: "conversation",
      desc: "Your favorite saying \u2014 the best advice you have for yourself."
    },
    {
      id: "early_recollections",
      title: "Early recollections",
      sector: 2,
      kind: "conversation",
      desc: "Three early memories with feelings and headlines \u2014 your perspective on today.",
      skippable: true
    },
    {
      id: "perspective",
      title: "Perspective",
      sector: 3,
      kind: "derived",
      desc: "The vantage point your early stories reveal about the current transition."
    },
    {
      id: "character_sketch",
      title: "Character sketch",
      sector: 3,
      kind: "derived",
      desc: "Who you are, in your own admired words \u2014 the self as a constructed solution."
    },
    {
      id: "preferred_settings",
      title: "Preferred settings",
      sector: 3,
      kind: "derived",
      desc: "The places, people, and problems you gravitate toward."
    },
    {
      id: "script",
      title: "Script",
      sector: 3,
      kind: "derived",
      desc: "How your self meets your setting \u2014 the storyline you are drawn to enact."
    },
    {
      id: "advice_to_self",
      title: "Advice to self",
      sector: 3,
      kind: "derived",
      desc: "Your motto unpacked into the call to action it already contains."
    },
    {
      id: "life_portrait",
      title: "Life portrait",
      sector: 4,
      kind: "derived",
      desc: "The six-part identity narrative assembled from everything you authorized.",
      hint: "\xB7 uses all inductions + goal"
    },
    {
      id: "identity_statement",
      title: "Identity statement",
      sector: 4,
      kind: "derived",
      desc: "Your success formula, in one sentence of your own words."
    },
    {
      id: "action_recipe",
      title: "Action recipe",
      sector: 5,
      kind: "derived",
      desc: "Concrete exploration steps that carry your intention into the world."
    },
    {
      id: "closing_check",
      title: "Closing check",
      sector: 5,
      kind: "conversation",
      desc: "Did we get there? Your goal is read back, and your motto is returned to you.",
      hint: "\xB7 reads your goal back, verbatim"
    }
  ];
  var MAP_EDGES = [
    ["counseling_goal", "role_models"],
    ["counseling_goal", "favorite_media"],
    ["counseling_goal", "favorite_story"],
    ["counseling_goal", "motto"],
    ["counseling_goal", "early_recollections"],
    ["role_models", "character_sketch"],
    ["favorite_media", "preferred_settings"],
    ["favorite_story", "script"],
    ["motto", "advice_to_self"],
    ["early_recollections", "perspective"],
    ["perspective", "character_sketch"],
    ["character_sketch", "script"],
    ["character_sketch", "life_portrait"],
    ["preferred_settings", "life_portrait"],
    ["script", "life_portrait"],
    ["advice_to_self", "life_portrait"],
    ["perspective", "life_portrait"],
    ["life_portrait", "identity_statement"],
    ["identity_statement", "action_recipe"],
    ["action_recipe", "closing_check"]
  ];

  // src/journey.ts
  var PROFILE_RE = /^[a-z0-9][a-z0-9_-]{0,39}$/;
  function profilePrefix(profile) {
    if (!profile || profile === "default") return "";
    if (!PROFILE_RE.test(profile)) throw new Error(`bad profile id: ${profile}`);
    return `profiles/${profile}`;
  }
  async function readArtifact(id, store) {
    const raw = await store.read(`${id}.json`);
    return raw === null ? null : JSON.parse(raw);
  }
  async function authorizedAt(id, store) {
    const art = await readArtifact(id, store);
    if (!art) return null;
    const ts = Date.parse(art.authorized_at);
    return Number.isNaN(ts) ? null : ts;
  }
  async function nodeStatus(id, store, playbooks2) {
    if (await store.exists(`${id}.json`)) {
      const pb2 = playbooks2(id);
      if (pb2?.kind === "derived") {
        const own = await authorizedAt(id, store) ?? 0;
        for (const dep of pb2.consumes) {
          if ((await authorizedAt(dep, store) ?? 0) > own) return "stale";
        }
      }
      return "authorized";
    }
    if (await store.exists(`${id}.session.json`)) return "in_progress";
    if (await store.exists(`${id}.draft.json`)) return "in_progress";
    const pb = playbooks2(id);
    if (!pb) return "planned";
    if (pb.consumes.length > 0) {
      const sources = pb.kind === "conversation" ? pb.consumes : pb.consumes.filter((d) => d !== "counseling_goal");
      const gate = pb.gate ?? (pb.kind === "conversation" ? "all" : "any");
      if (sources.length > 0) {
        let met = gate === "all";
        for (const s2 of sources) {
          const has = await store.exists(`${s2}.json`);
          if (gate === "all" && !has) met = false;
          if (gate === "any" && has) met = true;
        }
        if (!met) return "planned";
      }
    }
    return "available";
  }
  function firstString(v) {
    if (typeof v === "string" && v.trim()) return v;
    if (Array.isArray(v)) for (const item of v) {
      const s2 = firstString(item);
      if (s2) return s2;
    }
    if (typeof v === "object" && v !== null) {
      for (const val of Object.values(v)) {
        const s2 = firstString(val);
        if (s2) return s2;
      }
    }
    return null;
  }
  function distill(id, content) {
    const one = (text, label = null) => typeof text === "string" && text.trim() ? [{ label, text }] : [];
    switch (id) {
      case "counseling_goal":
        return one(content.restated_goal);
      case "motto":
        return one(content.motto ? `\u201C${content.motto}\u201D` : null);
      case "role_models": {
        const models = content.models ?? [];
        return one(models.map((m) => m.name).filter(Boolean).join(" \xB7 "));
      }
      case "favorite_story":
        return one(content.title);
      case "favorite_media": {
        const media = content.media ?? [];
        return one(media.map((m) => m.title).filter(Boolean).join(" \xB7 "));
      }
      case "early_recollections": {
        const recs = content.recollections ?? [];
        return one(recs.map((r) => r.headline).filter(Boolean).map((h) => `\u201C${h}\u201D`).join(" \xB7 "));
      }
      case "character_sketch":
        return one(content.sketch);
      case "perspective":
        return one(content.perspective_statement);
      case "preferred_settings":
        return one(content.niche_statement);
      case "script":
        return one(content.script_statement);
      case "advice_to_self":
        return one(content.call_to_action);
      case "life_portrait": {
        const movements = content.movements ?? [];
        const parts = movements.filter((m) => typeof m.text === "string" && m.text.trim()).map((m) => ({ label: m.title ?? null, text: m.text }));
        return parts.length > 0 ? parts : one(content.full_portrait);
      }
      case "identity_statement":
        return one(content.statement);
      case "action_recipe": {
        const week = content.week_one ?? [];
        return one(week.map((w) => `\u2022 ${w}`).join("\n"));
      }
      case "closing_check":
        return one((content.whats_different ?? []).join(" \xB7 "));
      default:
        return one(firstString(content));
    }
  }
  async function buildJourney(store, playbooks2, caps) {
    let authorized = 0;
    const nodes = [];
    for (const n of MAP_NODES) {
      const status = await nodeStatus(n.id, store, playbooks2);
      const pb = playbooks2(n.id);
      const kind = pb ? pb.elicit ? "conversation" : "derived" : n.kind;
      if (status === "authorized") authorized++;
      let distilled = [];
      let origin = null;
      if (status === "authorized" || status === "stale") {
        const art = await readArtifact(n.id, store);
        if (art) {
          distilled = distill(n.id, art.content);
          origin = art.origin ?? "generated";
        }
      }
      nodes.push({
        ...n,
        kind,
        status,
        distilled,
        origin,
        feeds: n.id === "counseling_goal" ? [] : MAP_EDGES.filter(([from]) => from === n.id).map(([, to]) => to),
        uses: n.id === "counseling_goal" ? [] : MAP_EDGES.filter(([, to]) => to === n.id).map(([from]) => from).filter((f2) => f2 !== "counseling_goal")
      });
    }
    return { sectors: MAP_SECTORS, nodes, authorized, total: MAP_NODES.length, ai: caps.ai, voice: caps.voice };
  }

  // src/verbatim.ts
  function normalize(s2) {
    return s2.toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, " ").trim();
  }
  function isRecord(v) {
    return typeof v === "object" && v !== null && !Array.isArray(v);
  }
  function gatherMarked(value, schema) {
    const found = [];
    function walk(v, s2) {
      if (!isRecord(s2)) return;
      if (s2["x-verbatim"] === true && typeof v === "string") {
        found.push(v);
        return;
      }
      if (Array.isArray(v) && isRecord(s2.items)) {
        for (const item of v) walk(item, s2.items);
        return;
      }
      if (isRecord(v) && isRecord(s2.properties)) {
        for (const [key, propSchema] of Object.entries(s2.properties)) {
          if (key in v) walk(v[key], propSchema);
        }
      }
    }
    walk(value, schema);
    return found;
  }
  function verbatimViolations(value, schema, userWords2) {
    const haystack = normalize(userWords2);
    const violations = [];
    function walk(v, s2) {
      if (!isRecord(s2)) return;
      if (s2["x-verbatim"] === true && typeof v === "string") {
        if (!haystack.includes(normalize(v))) violations.push(v);
        return;
      }
      if (Array.isArray(v) && isRecord(s2.items)) {
        for (const item of v) walk(item, s2.items);
        return;
      }
      if (isRecord(v) && isRecord(s2.properties)) {
        for (const [key, propSchema] of Object.entries(s2.properties)) {
          if (key in v) walk(v[key], propSchema);
        }
      }
    }
    walk(value, schema);
    return violations;
  }

  // src/engine.ts
  var GREETINGS = {
    en: "Hi \u2014 I'm glad you're here.",
    ru: "\u041F\u0440\u0438\u0432\u0435\u0442! \u0425\u043E\u0440\u043E\u0448\u043E, \u0447\u0442\u043E \u0442\u044B \u0437\u0434\u0435\u0441\u044C."
  };
  function stageOpening(stage, lang) {
    const localized = lang ? stage.opening_i18n?.[lang.code] : void 0;
    return (localized ?? stage.opening).trim();
  }
  var MAX_TURNS_PER_STAGE = 12;
  var CHECKER_SYSTEM = "You audit an interview transcript against a checklist. Judge only from what the user actually said. Return JSON only.";
  function interviewerSystem(pb, stage, lang, upstream) {
    const probes = (stage.probes ?? []).map((p) => `- When ${p.when}: ${p.then}`).join("\n");
    return [
      `You are the interviewer for the "${pb.title}" step of a career construction session.`,
      pb.elicit.persona.trim(),
      "Hard rules you must never break:",
      ...pb.elicit.guardrails.map((g) => `- ${g}`),
      `Current topic goal: ${stage.goal}`,
      `Anchor question for this topic (use this wording, adapted only lightly to the flow): ${stageOpening(stage, lang)}`,
      probes ? `Probe guidance:
${probes}` : "",
      "Ask exactly one question per message and keep each message to a few sentences.",
      "Messages wrapped in [brackets] are stage directions from the application, not the user. Never mention them.",
      lang ? `Conduct the entire conversation in ${lang.instruction}. Translate the anchor question faithfully \u2014 keep its meaning intact.` : "",
      pb.elicit.share_upstream && upstream && Object.keys(upstream).length > 0 ? `The user's authorized artifacts, for reference (when instructed to quote from these, quote exactly, word for word):
${JSON.stringify(upstream, null, 2)}` : ""
    ].filter(Boolean).join("\n\n");
  }
  async function checkStageDone(llm2, stage, exchange) {
    const transcript = exchange.map((e) => `${e.speaker}: ${e.text}`).join("\n");
    const checklist = stage.done_when.map((d, i) => `${i}. ${d}`).join("\n");
    const raw = await llm2.complete({
      tier: "small",
      system: CHECKER_SYSTEM,
      messages: [
        {
          role: "user",
          content: `Transcript:
${transcript}

Checklist:
${checklist}

For each item, is it satisfied?`
        }
      ],
      jsonSchema: {
        type: "object",
        required: ["results"],
        properties: {
          results: {
            type: "array",
            items: {
              type: "object",
              required: ["index", "satisfied"],
              properties: {
                index: { type: "integer" },
                satisfied: { type: "boolean" }
              }
            }
          }
        }
      }
    });
    try {
      const parsed = JSON.parse(raw);
      return parsed.results.length > 0 && parsed.results.every((r) => r.satisfied);
    } catch {
      return false;
    }
  }
  async function runElicit(pb, llm2, io, resume, lang, upstream) {
    const exchange = resume ? [...resume.exchange] : [];
    const messages = exchange.map((e) => ({
      role: e.speaker === "user" ? "user" : "assistant",
      content: e.text
    }));
    const stages = pb.elicit.stages;
    const startIndex = Math.min(resume?.stageIndex ?? 0, stages.length - 1);
    let resuming = resume !== void 0 && exchange.length > 0;
    for (let i = startIndex; i < stages.length; i++) {
      const stage = stages[i];
      io.note(`(topic ${i + 1} of ${stages.length}: ${stage.id})`);
      const system = interviewerSystem(pb, stage, lang, upstream);
      let skipGenerate = false;
      if (i === 0 && exchange.length === 0) {
        const opener = `${GREETINGS[lang?.code ?? "en"] ?? GREETINGS.en}

${stageOpening(stage, lang)}`;
        messages.push({ role: "assistant", content: opener });
        exchange.push({ speaker: "interviewer", text: opener });
        (io.sayAnchor ?? io.say)(opener);
        skipGenerate = true;
      } else if (resuming && exchange[exchange.length - 1]?.speaker === "interviewer") {
        skipGenerate = true;
        resuming = false;
      } else {
        messages.push({
          role: "user",
          content: resuming ? "[The session was interrupted earlier and has just been resumed. Welcome the user back in one short sentence and continue this topic where it left off.]" : `[Topic complete. Move on to the next topic and ask its anchor question: ${stageOpening(stage, lang)}]`
        });
        resuming = false;
      }
      let turns = 0;
      while (turns < MAX_TURNS_PER_STAGE) {
        if (!skipGenerate) {
          const question = await llm2.complete({ tier: "small", system, messages });
          messages.push({ role: "assistant", content: question });
          exchange.push({ speaker: "interviewer", text: question });
          io.say(question);
          if (exchange.some((e) => e.speaker === "user")) io.onTurn?.(exchange, i);
        }
        skipGenerate = false;
        const answer = await io.ask("you");
        if (answer.trim() === "/quit") return { exchange, userWords: userWords(exchange), aborted: true };
        if (answer.trim() === "/skip") {
          io.note(`(skipped remaining checks for topic "${stage.id}")`);
          break;
        }
        messages.push({ role: "user", content: answer });
        exchange.push({ speaker: "user", text: answer });
        io.onTurn?.(exchange, i);
        turns++;
        if (await checkStageDone(llm2, stage, exchange)) break;
      }
      if (turns >= MAX_TURNS_PER_STAGE) {
        io.note(`(topic "${stage.id}" reached its turn limit; moving on)`);
      }
    }
    return { exchange, userWords: userWords(exchange), aborted: false };
  }
  function userWords(exchange) {
    return exchange.filter((e) => e.speaker === "user").map((e) => e.text).join("\n");
  }
  function induceStepSystem(pb, step, lang) {
    return [
      `You are the induction engine for the "${pb.title}" step of a career construction session.`,
      `Task: ${step.task.trim()}`,
      "Every string in a field marked x-verbatim in the schema must be an exact quote of the user's own words \u2014 from the transcript or from the upstream artifacts. Never paraphrase those.",
      "Optional fields that allow null: emit null rather than inventing content the user never provided.",
      ...(step.validation ?? []).map((v) => `Constraint: ${v}`),
      "Return only JSON matching the schema.",
      lang ? `Write all free-text output in ${lang.instruction}. Strings marked x-verbatim must remain exactly as the user said them, in the user's own language.` : ""
    ].filter(Boolean).join("\n\n");
  }
  function compiledPrompts(pb, lang) {
    return {
      stages: (pb.elicit?.stages ?? []).map((s2) => ({
        id: s2.id,
        system: interviewerSystem(pb, s2, lang),
        done_when: s2.done_when
      })),
      checker: pb.elicit ? CHECKER_SYSTEM : null,
      induce: (pb.induce?.steps ?? []).map((st) => ({
        id: st.id,
        model_tier: st.model_tier,
        system: induceStepSystem(pb, st, lang),
        output_schema: st.output_schema
      }))
    };
  }
  function stringValuesDeep(v) {
    if (typeof v === "string") return [v];
    if (Array.isArray(v)) return v.flatMap(stringValuesDeep);
    if (typeof v === "object" && v !== null) return Object.values(v).flatMap(stringValuesDeep);
    return [];
  }
  async function runInduceStep(llm2, pb, step, transcript, upstream, verbatimSource2, feedback, lang, prior) {
    const system = induceStepSystem(pb, step, lang);
    const sourceBlock = transcript ? `Transcript:
${transcript}` : "There is no interview transcript for this step \u2014 compose strictly from the upstream artifacts below.";
    const upstreamBlock = Object.keys(upstream).length ? `

Authorized upstream artifacts:
${JSON.stringify(upstream, null, 2)}` : "";
    const priorBlock = prior ? `

The current draft, possibly hand-edited by the user (keep their edits unless the feedback says otherwise):
${JSON.stringify(prior, null, 2)}` : "";
    const feedbackBlock = feedback ? `

User feedback on the previous draft (address it):
${feedback}` : "";
    const attempt = async (extra) => {
      const raw = await llm2.complete({
        tier: step.model_tier,
        system,
        messages: [
          { role: "user", content: `${sourceBlock}${upstreamBlock}${priorBlock}${feedbackBlock}${extra}` }
        ],
        jsonSchema: step.output_schema,
        maxTokens: 8192
      });
      return JSON.parse(raw.replace(/^```(json)?\n?|\n?```$/g, ""));
    };
    let result = await attempt("");
    let violations = verbatimViolations(result, step.output_schema, verbatimSource2);
    if (violations.length > 0) {
      result = await attempt(
        `

Your previous attempt contained strings that are not exact quotes of the user. Fix these by quoting the user's actual words:
${violations.map((v) => `- "${v}"`).join("\n")}`
      );
      violations = verbatimViolations(result, step.output_schema, verbatimSource2);
      if (violations.length > 0) {
        result._verbatim_warnings = violations;
      }
    }
    return result;
  }
  async function runInduce(pb, llm2, exchange, upstream, io, feedback, lang, prior) {
    const transcript = exchange.map((e) => `${e.speaker === "user" ? "user" : "interviewer"}: ${e.text}`).join("\n");
    const verbatimSource2 = [
      ...exchange.filter((e) => e.speaker === "user").map((e) => e.text),
      ...stringValuesDeep(upstream)
    ].join("\n");
    const draft = {};
    for (const step of pb.induce.steps) {
      io.note(`(inducing: ${step.id}\u2026)`);
      Object.assign(draft, await runInduceStep(llm2, pb, step, transcript, upstream, verbatimSource2, feedback, lang, prior));
    }
    return draft;
  }
  function collectVerbatim(pb, draft) {
    const warnings = draft._verbatim_warnings ?? [];
    const all = (pb.induce?.steps ?? []).flatMap((step) => gatherMarked(draft, step.output_schema));
    const verified = [...new Set(all.filter((q) => !warnings.includes(q)))];
    return { verified_quotes: verified, warnings };
  }
  async function runConfirm(pb, draft, io, reinduce, opts = {}) {
    const confirm = pb.confirm;
    let current = draft;
    let existing = opts.existingFirst ?? false;
    if (io.review) {
      for (; ; ) {
        const candidates = current.candidates ?? [];
        const act = await io.review({
          mode: confirm.present,
          draft: current,
          candidates,
          choice_field: confirm.choice_field,
          authorize_language: confirm.authorize_language.trim(),
          existing,
          ...collectVerbatim(pb, current)
        });
        if (act.action === "feedback" || act.action === "reprocess") {
          io.note("(revising\u2026)");
          current = await reinduce(act.action === "feedback" ? act.text : void 0);
          existing = false;
          continue;
        }
        if (confirm.present === "candidates") {
          const field = confirm.choice_field ?? "chosen";
          const { candidates: _dropped, ...rest } = current;
          return { ...rest, [field]: act.value ?? candidates[0] ?? "" };
        }
        return current;
      }
    }
    if (confirm.present === "candidates") {
      const candidates = current.candidates ?? [];
      io.say("Here are drafts assembled from your own words \u2014 pick one, or edit:");
      candidates.forEach((c, i) => io.say(`  ${i + 1}. ${c}`));
      let chosen;
      while (chosen === void 0) {
        const answer = (await io.ask("number to pick, or type your own version")).trim();
        const n = Number(answer);
        if (Number.isInteger(n) && n >= 1 && n <= candidates.length) chosen = candidates[n - 1];
        else if (answer.length > 0) chosen = answer;
      }
      const field = confirm.choice_field ?? "chosen";
      const { candidates: _dropped, ...rest } = current;
      current = { ...rest, [field]: chosen };
      io.say(confirm.authorize_language.trim());
      return current;
    }
    for (; ; ) {
      io.say("Draft artifact \u2014 your words, organized:");
      io.say(JSON.stringify(current, null, 2));
      const answer = (await io.ask("press enter to authorize, or describe what to fix")).trim();
      if (answer === "") {
        io.say(confirm.authorize_language.trim());
        return current;
      }
      io.note("(revising\u2026)");
      current = await reinduce(answer);
    }
  }
  function toArtifact(pb, content, origin = "generated") {
    return {
      playbook_id: pb.id,
      playbook_version: pb.version,
      authorized_at: (/* @__PURE__ */ new Date()).toISOString(),
      origin,
      content
    };
  }

  // src/session.ts
  async function loadUpstream(pb, io, store) {
    const upstream = {};
    for (const dep of pb.consumes) {
      const raw = await store.read(`${dep}.json`);
      if (raw !== null) {
        upstream[dep] = JSON.parse(raw).content;
      } else {
        io.note(`(note: upstream artifact "${dep}" not found \u2014 continuing without it)`);
      }
    }
    return upstream;
  }
  async function saveArtifact(pb, content, exchange, store, origin = "generated") {
    await store.write(`${pb.id}.json`, JSON.stringify(toArtifact(pb, content, origin), null, 2));
    if (exchange.length > 0) {
      await store.write(`${pb.id}.transcript.json`, JSON.stringify(exchange, null, 2));
    }
  }
  async function runReviewSession(pb, llm2, io, opts) {
    const store = opts.store;
    const artRaw = await store.read(`${pb.id}.json`);
    if (artRaw === null) {
      io.say("There is no authorized artifact for this step yet.");
      return "blocked";
    }
    const upstream = await loadUpstream(pb, io, store);
    const transcriptRaw = await store.read(`${pb.id}.transcript.json`);
    const exchange = transcriptRaw !== null ? JSON.parse(transcriptRaw) : [];
    const content = JSON.parse(artRaw).content;
    const field = pb.confirm?.choice_field;
    const draft = pb.confirm?.present === "candidates" && field && typeof content[field] === "string" ? { ...content, candidates: [content[field]] } : { ...content };
    const authorized = await runConfirm(
      pb,
      draft,
      io,
      (feedback) => runInduce(pb, llm2, exchange, upstream, io, feedback, opts.lang),
      { existingFirst: true }
    );
    await saveArtifact(pb, authorized, exchange, store);
    io.say(`Artifact authorized and saved (${pb.id}).`);
    if (pb.invalidates.length > 0) {
      io.note(`(in the full app this would mark stale: ${pb.invalidates.join(", ")})`);
    }
    return "authorized";
  }
  async function runPlaybookSession(pb, llm2, baseIO, opts) {
    const store = opts.store;
    const sessionPath = `${pb.id}.session.json`;
    const io = {
      ...baseIO,
      onTurn: (exchange2, stageIndex) => {
        void store.write(
          sessionPath,
          JSON.stringify({ exchange: exchange2, stage_index: stageIndex }, null, 2)
        );
        baseIO.onTurn?.(exchange2, stageIndex);
      }
    };
    if (opts.header !== false) {
      io.say(`\u2501\u2501\u2501 ${pb.title} \u2501\u2501\u2501`);
      io.say(`What happens in this step (shown in full, always):
${pb.purpose.trim()}`);
    }
    const upstream = await loadUpstream(pb, io, store);
    let exchange = [];
    if (pb.elicit) {
      let resume;
      const savedRaw = await store.read(sessionPath);
      if (savedRaw !== null) {
        const saved = JSON.parse(savedRaw);
        if (saved.exchange.length > 0) {
          if (opts.autoResume) {
            resume = saved;
          } else {
            const answer = (await io.ask(`a saved conversation (${saved.exchange.length} entries) exists \u2014 (r)esume it or (s)tart over`)).trim().toLowerCase();
            if (answer.startsWith("r")) resume = saved;
          }
        }
      }
      if (resume?.elicit_done) {
        exchange = resume.exchange;
        io.note("(the interview was already complete \u2014 moving straight to drafting)");
      } else {
        const elicited = await runElicit(
          pb,
          llm2,
          io,
          resume ? { exchange: resume.exchange, stageIndex: resume.stage_index } : void 0,
          opts.lang,
          upstream
        );
        if (elicited.aborted) {
          io.note("(no artifact yet \u2014 your progress is saved; open this step again to resume)");
          return "aborted";
        }
        exchange = elicited.exchange;
        await store.write(
          sessionPath,
          JSON.stringify(
            { exchange, stage_index: pb.elicit.stages.length, elicit_done: true },
            null,
            2
          )
        );
        io.note("(the conversation is complete \u2014 solidifying it into a draft\u2026)");
      }
    } else {
      const present = pb.consumes.filter((d) => d in upstream);
      if (present.length === 0 && pb.consumes.length > 0) {
        io.say(`This derived step needs upstream artifacts (${pb.consumes.join(", ")}) and none exist yet. Author those first.`);
        return "blocked";
      }
      io.note("(derived step \u2014 no interview; drafting from your authorized artifacts)");
    }
    const draft = await runInduce(pb, llm2, exchange, upstream, io, void 0, opts.lang);
    const authorized = await runConfirm(
      pb,
      draft,
      io,
      (feedback) => runInduce(pb, llm2, exchange, upstream, io, feedback, opts.lang)
    );
    await saveArtifact(pb, authorized, exchange, store);
    await store.remove(sessionPath);
    io.say(`Artifact authorized and saved (${pb.id}).`);
    if (pb.invalidates.length > 0) {
      io.note(`(in the full app this would mark stale: ${pb.invalidates.join(", ")})`);
    }
    return "authorized";
  }

  // src/manual.ts
  function manualFormSchema(pb) {
    const properties = {};
    const required = /* @__PURE__ */ new Set();
    for (const step of pb.induce?.steps ?? []) {
      const s2 = step.output_schema;
      Object.assign(properties, s2.properties ?? {});
      for (const r of s2.required ?? []) required.add(r);
    }
    const field = pb.confirm?.present === "candidates" ? pb.confirm.choice_field : void 0;
    if (field) {
      delete properties.candidates;
      required.delete("candidates");
      properties[field] = { type: "string" };
      required.add(field);
    }
    return { properties, required: [...required] };
  }
  async function loadExchange(id, store) {
    const session = await store.read(`${id}.session.json`);
    if (session !== null) {
      return JSON.parse(session).exchange ?? [];
    }
    const transcript = await store.read(`${id}.transcript.json`);
    if (transcript !== null) {
      return JSON.parse(transcript);
    }
    return [];
  }
  async function verbatimSource(pb, store, upstream) {
    return [
      ...(await loadExchange(pb.id, store)).filter((e) => e.speaker === "user").map((e) => e.text),
      ...stringValuesDeep(upstream)
    ].join("\n");
  }
  function manualWarnings(pb, content, source) {
    const all = (pb.induce?.steps ?? []).flatMap((step) => verbatimViolations(content, step.output_schema, source));
    return [...new Set(all)];
  }
  function reconstructManualAnswers(pb, exchange) {
    const stages = pb?.elicit?.stages ?? [];
    if (stages.length === 0 || exchange.length === 0) return null;
    const anchors = /* @__PURE__ */ new Map();
    for (const s2 of stages) {
      anchors.set(s2.opening.trim(), s2.id);
      for (const o of Object.values(s2.opening_i18n ?? {})) anchors.set(o.trim(), s2.id);
    }
    const answers = {};
    let current = null;
    for (const e of exchange) {
      if (e.speaker === "interviewer") {
        const sid = anchors.get(e.text.trim());
        if (!sid) return null;
        current = sid;
      } else {
        if (!current) return null;
        answers[current] = answers[current] ? `${answers[current]}
${e.text}` : e.text;
      }
    }
    return answers;
  }
  function buildManualSession(pb, answers, lang) {
    const stages = pb.elicit?.stages ?? [];
    const exchange = [];
    let lastAnswered = -1;
    stages.forEach((stage, i) => {
      const text = (answers[stage.id] ?? "").trim();
      if (!text) return;
      exchange.push({ speaker: "interviewer", text: stageOpening(stage, lang) });
      exchange.push({ speaker: "user", text });
      lastAnswered = i;
    });
    if (lastAnswered === -1) return null;
    const done = stages.every((s2) => (answers[s2.id] ?? "").trim());
    return {
      exchange,
      stage_index: done ? stages.length : lastAnswered,
      elicit_done: done,
      manual_answers: answers
    };
  }

  // src/config.ts
  function cfg(key) {
    const g = globalThis;
    if (g.CC_CONFIG && key in g.CC_CONFIG) return g.CC_CONFIG[key];
    return typeof process !== "undefined" ? process.env?.[key] : void 0;
  }

  // src/llm.ts
  function isRecord2(v) {
    return typeof v === "object" && v !== null && !Array.isArray(v);
  }
  function sanitizeSchema(schema) {
    const dropped = /* @__PURE__ */ new Set([
      "minItems",
      "maxItems",
      "minLength",
      "maxLength",
      "minimum",
      "maximum",
      "multipleOf"
    ]);
    function walk(node) {
      if (Array.isArray(node)) return node.map(walk);
      if (!isRecord2(node)) return node;
      const out = {};
      for (const [key, value] of Object.entries(node)) {
        if (key.startsWith("x-") || dropped.has(key)) continue;
        out[key] = walk(value);
      }
      if (out.type === "object" && isRecord2(out.properties)) {
        out.additionalProperties = false;
        out.required = Object.keys(out.properties);
      }
      return out;
    }
    return walk(schema);
  }
  var OPENROUTER_BASE = "https://openrouter.ai/api/v1";
  var OpenAICompatAdapter = class {
    provider;
    constructor(provider) {
      this.provider = provider;
    }
    get zdr() {
      return this.provider === "openrouter" && cfg("LLM_ZDR") !== "0";
    }
    tier(t) {
      const U = t === "small" ? "SMALL" : "LARGE";
      const defaults = {
        small: this.provider === "openrouter" ? "deepseek/deepseek-v4-flash" : "",
        large: this.provider === "openrouter" ? "deepseek/deepseek-v4-pro" : ""
      };
      const baseUrl = cfg(`LLM_${U}_BASE_URL`) ?? cfg("LLM_BASE_URL") ?? (this.provider === "openrouter" ? OPENROUTER_BASE : "");
      const apiKey = cfg(`LLM_${U}_API_KEY`) ?? cfg("LLM_API_KEY") ?? "";
      const model = cfg(`LLM_${U}_MODEL`) ?? defaults[t];
      if (!baseUrl || !model) throw new Error(`LLM ${t} tier is not configured (base url / model)`);
      return { baseUrl, apiKey, model };
    }
    describe() {
      const s2 = this.tier("small");
      const l = this.tier("large");
      const zdr = this.zdr ? ", zdr=on" : "";
      return `${this.provider} (small=${s2.model}, large=${l.model}${zdr})`;
    }
    async complete(opts) {
      const ep = this.tier(opts.tier);
      const body = {
        model: ep.model,
        max_tokens: opts.maxTokens ?? (opts.jsonSchema ? 4096 : 1024),
        messages: [{ role: "system", content: opts.system }, ...opts.messages]
      };
      if (opts.jsonSchema) {
        body.response_format = {
          type: "json_schema",
          json_schema: { name: "artifact", strict: true, schema: sanitizeSchema(opts.jsonSchema) }
        };
      }
      if (ep.baseUrl.startsWith(OPENROUTER_BASE)) {
        if (this.zdr) body.zdr = true;
        const provider = { sort: "price" };
        if (this.zdr) provider.data_collection = "deny";
        if (opts.jsonSchema) provider.require_parameters = true;
        const ignore = (cfg("LLM_IGNORE_PROVIDERS") ?? "").split(",").map((s2) => s2.trim()).filter(Boolean);
        if (ignore.length > 0) provider.ignore = ignore;
        body.provider = provider;
      }
      const res = await fetch(`${ep.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${ep.apiKey}`,
          "x-title": "Career Counseling"
        },
        body: JSON.stringify(body)
      });
      if (!res.ok) throw new Error(`LLM request failed: ${res.status} ${await res.text()}`);
      const data = await res.json();
      return data.choices?.[0]?.message?.content ?? "";
    }
  };
  function aiAvailable() {
    const p = cfg("LLM_PROVIDER") ?? "anthropic";
    if (p === "ollama") return true;
    if (p === "openrouter" || p === "openai") {
      return Boolean(cfg("LLM_API_KEY") || cfg("LLM_SMALL_API_KEY") || cfg("LLM_LARGE_API_KEY"));
    }
    return Boolean(cfg("ANTHROPIC_API_KEY"));
  }

  // src/mobile-main.ts
  var CapStorage = class {
    p(path) {
      return `cc/${path}`;
    }
    async read(path) {
      try {
        const r = await Filesystem.readFile({ path: this.p(path), directory: Directory.Data, encoding: Encoding.UTF8 });
        return typeof r.data === "string" ? r.data : null;
      } catch {
        return null;
      }
    }
    async write(path, data) {
      await Filesystem.writeFile({
        path: this.p(path),
        directory: Directory.Data,
        encoding: Encoding.UTF8,
        data,
        recursive: true
      });
    }
    async remove(path) {
      try {
        await Filesystem.deleteFile({ path: this.p(path), directory: Directory.Data });
      } catch {
      }
    }
    async list(path) {
      try {
        const r = await Filesystem.readdir({ path: this.p(path), directory: Directory.Data });
        return r.files.map((f2) => f2.name);
      } catch {
        return [];
      }
    }
    async exists(path) {
      try {
        await Filesystem.stat({ path: this.p(path), directory: Directory.Data });
        return true;
      } catch {
        return false;
      }
    }
  };
  var rootStore = new CapStorage();
  var playbooks = (id) => PLAYBOOKS[id] ?? null;
  var SESSION_LANGS = {
    ru: { code: "ru", instruction: "Russian, addressing the user with the informal, warm \u201C\u0442\u044B\u201D (never the formal \u201C\u0432\u044B\u201D)" }
  };
  var SETTING_KEYS = [
    "LLM_API_KEY",
    "OPENAI_API_KEY",
    "LLM_SMALL_MODEL",
    "LLM_LARGE_MODEL",
    "VENDOR_URL"
  ];
  async function loadConfig() {
    const config = {
      LLM_PROVIDER: "openrouter",
      LLM_IGNORE_PROVIDERS: "DeepSeek,StreamLake,Baidu,Alibaba,SiliconFlow"
    };
    for (const key of SETTING_KEYS) {
      const { value } = await Preferences.get({ key });
      if (value) config[key] = value;
    }
    globalThis.CC_CONFIG = config;
  }
  var ready = loadConfig();
  var llm = null;
  function getLlm() {
    llm ??= new OpenAICompatAdapter("openrouter");
    return llm;
  }
  var silentIO = { say() {
  }, note() {
  }, ask: async () => "" };
  var jsonRes = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  async function listProfiles() {
    const out = [{ id: "default", name: null }];
    for (const entry of await rootStore.list("profiles")) {
      const meta = await rootStore.read(`profiles/${entry}/profile.json`);
      if (meta === null) continue;
      let name = entry;
      try {
        name = JSON.parse(meta).name ?? entry;
      } catch {
      }
      out.push({ id: entry, name });
    }
    return out;
  }
  async function createProfile(name) {
    const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32) || `client-${Date.now().toString(36)}`;
    let id = base;
    for (let n = 2; await rootStore.exists(`profiles/${id}/profile.json`); n++) id = `${base}-${n}`;
    await rootStore.write(`profiles/${id}/profile.json`, JSON.stringify({ name, created_at: (/* @__PURE__ */ new Date()).toISOString() }, null, 2));
    return { id, name };
  }
  async function handleApi(url, method, body) {
    const path = url.pathname;
    const lang = SESSION_LANGS[url.searchParams.get("lang") ?? ""];
    const store = scoped(rootStore, profilePrefix(url.searchParams.get("profile")));
    const idOf = (prefix) => path.slice(prefix.length);
    if (path === "/api/journey" || path === "/api/map") {
      return jsonRes(await buildJourney(store, playbooks, {
        ai: aiAvailable(),
        voice: Boolean(cfg("OPENAI_API_KEY"))
      }));
    }
    if (path === "/api/reset" && method === "POST") {
      const nodeParam = url.searchParams.get("node");
      const targets = nodeParam ? MAP_NODES.filter((n) => n.id === nodeParam) : MAP_NODES;
      if (nodeParam && targets.length === 0) return jsonRes({ error: "unknown node" }, 400);
      let removed = 0;
      for (const n of targets) {
        for (const suffix of [".json", ".session.json", ".draft.json", ".transcript.json"]) {
          if (await store.exists(`${n.id}${suffix}`)) {
            await store.remove(`${n.id}${suffix}`);
            removed++;
          }
        }
      }
      return jsonRes({ ok: true, removed });
    }
    if (path === "/api/profiles") {
      if (method === "POST") {
        const name = String(body.name ?? "").trim();
        if (!name) return jsonRes({ error: "name required" }, 400);
        return jsonRes(await createProfile(name));
      }
      return jsonRes({ profiles: await listProfiles() });
    }
    if (path.startsWith("/api/playbook/")) {
      const pb = playbooks(idOf("/api/playbook/"));
      if (!pb) return jsonRes({ planned: true }, 404);
      return jsonRes({
        id: pb.id,
        title: pb.title,
        kind: pb.kind,
        purpose: pb.purpose.trim(),
        consumes: pb.consumes,
        invalidates: pb.invalidates,
        stages: pb.elicit?.stages.map((s2) => ({
          id: s2.id,
          goal: s2.goal,
          opening: stageOpening(s2, lang),
          probes: s2.probes ?? [],
          done_when: s2.done_when
        })) ?? [],
        form: manualFormSchema(pb),
        confirm_present: pb.confirm?.present ?? null,
        choice_field: pb.confirm?.choice_field ?? null,
        authorize_language: pb.confirm?.authorize_language.trim() ?? "",
        compiled: compiledPrompts(pb, lang)
      });
    }
    if (path.startsWith("/api/session/")) {
      const id = idOf("/api/session/");
      const session = await store.read(`${id}.session.json`);
      if (session === null) {
        const transcript = await store.read(`${id}.transcript.json`);
        if (transcript !== null) {
          const exchange = JSON.parse(transcript);
          const answers = reconstructManualAnswers(playbooks(id), exchange);
          return jsonRes({ exchange, settled: true, ...answers ? { manual_answers: answers } : {} });
        }
        return jsonRes({ error: "no session" }, 404);
      }
      return new Response(session, { status: 200, headers: { "content-type": "application/json" } });
    }
    if (path.startsWith("/api/artifact/")) {
      const art = await store.read(`${idOf("/api/artifact/")}.json`);
      if (art === null) return jsonRes({ error: "no artifact" }, 404);
      return new Response(art, { status: 200, headers: { "content-type": "application/json" } });
    }
    if (path.startsWith("/api/upstream/")) {
      const pb = playbooks(idOf("/api/upstream/"));
      if (!pb) return jsonRes({ error: "no playbook" }, 404);
      return jsonRes({ upstream: await loadUpstream(pb, silentIO, store) });
    }
    if (path.startsWith("/api/draft/")) {
      const id = idOf("/api/draft/");
      const pb = playbooks(id);
      if (!pb) return jsonRes({ error: "no playbook" }, 404);
      const draftPath = `${id}.draft.json`;
      if (method === "PUT") {
        const content = body.content ?? {};
        await store.write(draftPath, JSON.stringify(
          { content, origin: body.origin ?? null, saved_at: (/* @__PURE__ */ new Date()).toISOString() },
          null,
          2
        ));
        const source = await verbatimSource(pb, store, await loadUpstream(pb, silentIO, store));
        return jsonRes({ ok: true, warnings: manualWarnings(pb, content, source) });
      }
      if (method === "DELETE") {
        await store.remove(draftPath);
        return jsonRes({ ok: true });
      }
      const draft = await store.read(draftPath);
      if (draft === null) return jsonRes({ error: "no draft" }, 404);
      return new Response(draft, { status: 200, headers: { "content-type": "application/json" } });
    }
    if (path.startsWith("/api/authorize/") && method === "POST") {
      const id = idOf("/api/authorize/");
      const pb = playbooks(id);
      if (!pb) return jsonRes({ error: "no playbook" }, 404);
      const content = body.content;
      if (!content || typeof content !== "object") return jsonRes({ error: "content required" }, 400);
      const origin = ["manual", "generated", "mixed"].includes(String(body.origin)) ? body.origin : "manual";
      const upstream = await loadUpstream(pb, silentIO, store);
      const warnings = manualWarnings(pb, content, await verbatimSource(pb, store, upstream));
      const exchange = await loadExchange(id, store);
      await saveArtifact(pb, content, exchange, store, origin);
      await store.remove(`${id}.draft.json`);
      await store.remove(`${id}.session.json`);
      return jsonRes({ ok: true, warnings });
    }
    if (path.startsWith("/api/compose/") && method === "POST") {
      const id = idOf("/api/compose/");
      const pb = playbooks(id);
      if (!pb) return jsonRes({ error: "no playbook" }, 404);
      if (!aiAvailable()) return jsonRes({ error: "no model configured \u2014 add a key in settings" }, 503);
      const feedback = typeof body.feedback === "string" && body.feedback.trim() ? body.feedback.trim() : void 0;
      const prior = body.prior && typeof body.prior === "object" ? body.prior : void 0;
      const exchange = await loadExchange(id, store);
      const upstream = await loadUpstream(pb, silentIO, store);
      const draft = await runInduce(pb, getLlm(), exchange, upstream, silentIO, feedback, lang, prior);
      const { candidates = [], _verbatim_warnings = [], ...rest } = draft;
      const field = pb.confirm?.present === "candidates" ? pb.confirm.choice_field : void 0;
      const content = field ? { ...rest, [field]: candidates[0] ?? "" } : rest;
      return jsonRes({ content, candidates: field ? candidates : [], warnings: _verbatim_warnings });
    }
    if (path.startsWith("/api/manual-session/") && method === "PUT") {
      const id = idOf("/api/manual-session/");
      const pb = playbooks(id);
      if (!pb?.elicit) return jsonRes({ error: "not a conversation playbook" }, 404);
      const answers = body.answers ?? {};
      const sessPath = `${id}.session.json`;
      const existing = await store.read(sessPath);
      if (existing !== null) {
        const saved = JSON.parse(existing);
        if (!saved.manual_answers) return jsonRes({ error: "an interviewer-led session exists for this step" }, 409);
      }
      const built = buildManualSession(pb, answers, lang);
      if (!built) {
        await store.remove(sessPath);
        return jsonRes({ ok: true, cleared: true });
      }
      await store.write(sessPath, JSON.stringify(built, null, 2));
      return jsonRes({ ok: true });
    }
    return jsonRes({ error: "not found" }, 404);
  }
  var realFetch = window.fetch.bind(window);
  window.fetch = (async (input, init) => {
    const urlStr = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (!urlStr.startsWith("/api/")) return realFetch(input, init);
    await ready;
    const url = new URL(urlStr, "http://app.local");
    const method = init?.method ?? "GET";
    let body = {};
    if (typeof init?.body === "string" && init.body) {
      try {
        body = JSON.parse(init.body);
      } catch {
        return jsonRes({ error: "bad json body" }, 400);
      }
    }
    try {
      return await handleApi(url, method, body);
    } catch (err) {
      return jsonRes({ error: err.message }, 500);
    }
  });
  function makeSessionWS(urlStr) {
    const url = new URL(urlStr.replace(/^ws/, "http"));
    const id = url.searchParams.get("playbook") ?? "";
    const pb = playbooks(id);
    let open = true;
    const pendingAsks = [];
    const pendingReviews = [];
    const sock = {
      readyState: 1,
      onmessage: null,
      onclose: null,
      send(data) {
        const msg = JSON.parse(String(data));
        if (msg.type === "answer") pendingAsks.shift()?.(msg.text ?? "");
        else if (msg.type === "review_action") {
          const act = msg.action === "feedback" ? { action: "feedback", text: msg.text ?? "" } : msg.action === "reprocess" ? { action: "reprocess" } : { action: "authorize", value: msg.value };
          pendingReviews.shift()?.(act);
        }
      },
      close() {
        open = false;
        sock.readyState = 3;
      }
    };
    const emit = (payload) => {
      if (open) sock.onmessage?.({ data: JSON.stringify(payload) });
    };
    const finish = () => {
      if (!open) return;
      sock.readyState = 3;
      open = false;
      sock.onclose?.();
    };
    setTimeout(() => {
      void (async () => {
        await ready;
        if (!pb) {
          emit({ type: "error", text: "unknown playbook" });
          return finish();
        }
        if (!aiAvailable()) {
          emit({ type: "error", text: "no model configured \u2014 add a key in settings, or use practitioner mode" });
          return finish();
        }
        const store = scoped(rootStore, profilePrefix(url.searchParams.get("profile")));
        const lang = SESSION_LANGS[url.searchParams.get("lang") ?? ""];
        const io = {
          say: (t) => emit({ type: "say", text: t }),
          sayAnchor: (t) => emit({ type: "say", text: t, anchor: true }),
          note: (t) => emit({ type: "note", text: t }),
          ask: (prompt) => new Promise((resolve2) => {
            pendingAsks.push(resolve2);
            emit({ type: "ask", text: prompt });
          }),
          review: (payload) => new Promise((resolve2) => {
            pendingReviews.push(resolve2);
            emit({ type: "review", payload });
          })
        };
        try {
          const outcome = url.searchParams.get("mode") === "review" ? await runReviewSession(pb, getLlm(), io, { lang, store }) : await runPlaybookSession(pb, getLlm(), io, {
            header: false,
            lang,
            store,
            autoResume: url.searchParams.get("resume") === "1"
          });
          emit({ type: "done", text: outcome });
        } catch (err) {
          emit({ type: "error", text: err.message });
        }
        finish();
      })();
    }, 0);
    return sock;
  }
  function makeVoiceWS(urlStr) {
    const key = cfg("OPENAI_API_KEY") ?? "";
    const langCode = new URL(urlStr.replace(/^ws/, "http")).searchParams.get("lang") ?? "";
    const sock = {
      readyState: 0,
      onmessage: null,
      onclose: null,
      send() {
      },
      close() {
      }
    };
    const emit = (payload) => {
      sock.onmessage?.({ data: JSON.stringify(payload) });
    };
    if (!key) {
      setTimeout(() => {
        emit({ type: "error", text: "no OpenAI key configured \u2014 add it in settings" });
        sock.onclose?.();
      }, 0);
      return sock;
    }
    const upstream = new RealWebSocket(
      "wss://api.openai.com/v1/realtime?intent=transcription",
      ["realtime", `openai-insecure-api-key.${key}`]
    );
    let audioSent = false;
    upstream.onopen = () => {
      sock.readyState = 1;
      upstream.send(JSON.stringify({
        type: "session.update",
        session: {
          type: "transcription",
          audio: {
            input: {
              format: { type: "audio/pcm", rate: 24e3 },
              transcription: { model: "gpt-realtime-whisper", ...langCode ? { language: langCode } : {} },
              turn_detection: null,
              noise_reduction: { type: "near_field" }
            }
          }
        }
      }));
    };
    upstream.onmessage = (ev) => {
      let msg;
      try {
        msg = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      if (msg.type === "session.created") emit({ type: "ready" });
      else if (msg.type === "conversation.item.input_audio_transcription.delta") {
        emit({ type: "delta", item: msg.item_id, text: msg.delta ?? "" });
      } else if (msg.type === "conversation.item.input_audio_transcription.completed") {
        emit({ type: "final", item: msg.item_id, text: msg.transcript ?? "" });
        upstream.close();
      } else if (msg.type === "error") emit({ type: "error", text: msg.error?.message ?? "transcription error" });
    };
    upstream.onclose = () => {
      sock.readyState = 3;
      sock.onclose?.();
    };
    upstream.onerror = () => emit({ type: "error", text: "voice connection failed" });
    sock.send = (data) => {
      if (upstream.readyState !== RealWebSocket.OPEN) return;
      if (typeof data === "string") {
        try {
          const msg = JSON.parse(data);
          if (msg.type === "stop") {
            if (audioSent) upstream.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
            else upstream.close();
          }
        } catch {
        }
        return;
      }
      audioSent = true;
      const bytes = new Uint8Array(data);
      let bin = "";
      for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
      upstream.send(JSON.stringify({ type: "input_audio_buffer.append", audio: btoa(bin) }));
    };
    sock.close = () => upstream.close();
    return sock;
  }
  var RealWebSocket = window.WebSocket;
  var WSShim = function(url, protocols) {
    if (url.includes("/ws/voice")) return makeVoiceWS(url);
    if (url.includes("/ws?")) return makeSessionWS(url);
    return new RealWebSocket(url, protocols);
  };
  WSShim.CONNECTING = 0;
  WSShim.OPEN = 1;
  WSShim.CLOSING = 2;
  WSShim.CLOSED = 3;
  window.WebSocket = WSShim;
  function injectSettings() {
    const gear = document.createElement("button");
    gear.id = "ccGear";
    gear.textContent = "\u2699";
    gear.style.cssText = "position:fixed;bottom:14px;right:14px;z-index:70;width:40px;height:40px;border-radius:99px;border:1px solid rgba(128,116,98,.4);background:rgba(255,255,255,.85);font-size:18px;cursor:pointer;";
    const panel = document.createElement("div");
    panel.id = "ccSettingsPanel";
    panel.hidden = true;
    panel.style.cssText = "position:fixed;bottom:62px;right:14px;z-index:70;width:min(320px,88vw);padding:14px;border-radius:14px;border:1px solid rgba(128,116,98,.4);background:#fffdf9;box-shadow:0 8px 30px rgba(61,54,45,.25);font:13px Karla,sans-serif;color:#3c352b;display:flex;flex-direction:column;gap:8px;";
    const field = (id, label, type = "password") => `<label style="display:flex;flex-direction:column;gap:3px;font-size:11px;color:#8a7f6e">${label}<input id="${id}" type="${type}" autocomplete="off" style="padding:8px;border:1px solid #d8d0c2;border-radius:8px;font-size:13px"/></label>`;
    panel.innerHTML = `<div style="font-weight:600">Keys stay on this device</div>` + field("ccKeyLlm", "OpenRouter API key (AI interviewer)") + field("ccKeyVoice", "OpenAI API key (voice dictation, optional)") + field("ccInvite", "Invite code (get a free key)", "text") + `<button id="ccRedeem" style="padding:8px;border-radius:8px;border:1px solid #d8d0c2;background:none;cursor:pointer">Redeem invite</button><button id="ccSave" style="padding:9px;border-radius:8px;border:none;background:#6f8265;color:#fff;font-weight:600;cursor:pointer">Save & reload</button><div id="ccSettingsNote" style="font-size:11px;color:#8a7f6e"></div>`;
    document.body.append(gear, panel);
    const $ = (id) => document.getElementById(id);
    gear.addEventListener("click", () => {
      panel.hidden = !panel.hidden;
      if (!panel.hidden) {
        $("ccKeyLlm").value = cfg("LLM_API_KEY") ?? "";
        $("ccKeyVoice").value = cfg("OPENAI_API_KEY") ?? "";
      }
    });
    document.getElementById("ccSave").addEventListener("click", () => {
      void (async () => {
        await Preferences.set({ key: "LLM_API_KEY", value: $("ccKeyLlm").value.trim() });
        await Preferences.set({ key: "OPENAI_API_KEY", value: $("ccKeyVoice").value.trim() });
        location.reload();
      })();
    });
    document.getElementById("ccRedeem").addEventListener("click", () => {
      void (async () => {
        const note = document.getElementById("ccSettingsNote");
        const vendor = cfg("VENDOR_URL") ?? "";
        const code = $("ccInvite").value.trim();
        if (!vendor) {
          note.textContent = "No key service configured in this build.";
          return;
        }
        if (!code) {
          note.textContent = "Enter your invite code first.";
          return;
        }
        note.textContent = "Redeeming\u2026";
        try {
          const res = await realFetch(`${vendor}/redeem`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ code })
          });
          const data = await res.json();
          if (!res.ok || !data.key) throw new Error(data.error ?? `${res.status}`);
          await Preferences.set({ key: "LLM_API_KEY", value: data.key });
          note.textContent = "Key installed \u2014 reloading\u2026";
          setTimeout(() => location.reload(), 700);
        } catch (err) {
          note.textContent = `Could not redeem: ${err.message}`;
        }
      })();
    });
  }
  document.addEventListener("DOMContentLoaded", () => {
    injectSettings();
    const capacitor = window.Capacitor;
    if (capacitor?.isNativePlatform?.()) {
      const style = document.createElement("style");
      style.textContent = "#exportBtn { display: none; }";
      document.head.append(style);
    }
  });
})();
/*! Bundled license information:

@capacitor/core/dist/index.js:
  (*! Capacitor: https://capacitorjs.com/ - MIT License *)
*/
