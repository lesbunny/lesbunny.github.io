({
  default: (() => {
    const { findByProps, findByName, findByStoreName, findByTypeNameAll } = vendetta.metro;
    const { React, ReactNative, chroma, constants } = vendetta.metro.common;
    const { before, after, instead } = vendetta.patcher;
    const { storage } = vendetta.plugin;
    const { findInReactTree } = vendetta.utils;
    const rawColors = vendetta.ui.rawColors || {};
    const showToast = (...args) => { try { const fn = vendetta.ui.toasts?.showToast; if (typeof fn === "function") return fn(...args); } catch {} console.warn("[KiraUtils]", ...args); };
    let catboxPendingLink = null;
    const uploadPatchState = { proto: null, original: null, wrapper: null };
    const Messages = (() => { try { return vendetta.metro.common.i18n.Messages || {}; } catch { return {}; } })();
    const BUILT_IN_TAGS = [Messages.AI_TAG, Messages.BOT_TAG_BOT, Messages.BOT_TAG_SERVER, Messages.SYSTEM_DM_TAG_SYSTEM, Messages.GUILD_AUTOMOD_USER_BADGE_TEXT, Messages.REMIXING_TAG].filter(Boolean);
    const MAX_TAGS = ["WEBHOOK", "OWNER", "ADMIN", "STAFF", "MOD", "VC Mod", "Chat Mod"];
    const featureCleanups = Object.create(null);
    let enabled = false;

    const safeFind = (fn, ...args) => { try { return typeof fn === "function" ? fn(...args) : null; } catch { return null; } };
    const addCleanup = (list, result) => {
      if (typeof result === "function") list.push(result);
      else if (Array.isArray(result)) list.push(...result.filter(x => typeof x === "function"));
    };
    const cleanup = list => { for (const fn of (list || []).splice(0).reverse()) { try { fn(); } catch {} } };

    function parseTenorGifURL(url) {
      if (typeof url !== "string") return;
      const segments = url.split("/");
      const hostIndex = segments.findIndex(segment => segment.endsWith(".tenor.com"));
      if (hostIndex < 0) return;
      const [host, id, file] = segments.slice(hostIndex, hostIndex + 3);
      if (!host || !id || !file) return;
      const filename = file.split(".")[0];
      if (!filename) return;
      return "https://" + host + "/" + id.slice(0, -2) + "AC/" + filename + ".gif";
    }

    function startTenorFix() {
      const cleanups = [];
      const mediaManager = safeFind(findByProps, "downloadMediaAsset");
      const shareActions = safeFind(findByProps, "useMediaShareActions");
      if (typeof mediaManager?.downloadMediaAsset === "function") {
        addCleanup(cleanups, before("downloadMediaAsset", mediaManager, args => {
          const parsed = parseTenorGifURL(args?.[0]);
          if (parsed) { args[0] = parsed; args[1] = 1; }
        }));
      }
      if (typeof shareActions?.useMediaShareActions === "function") {
        addCleanup(cleanups, before("useMediaShareActions", shareActions, args => {
          const source = args?.[0]?.source;
          const parsed = parseTenorGifURL(source?.uri);
          if (source && parsed) { source.sourceURI = parsed; delete source.videoURI; }
        }));
      }
      return () => cleanup(cleanups);
    }

    function getStaffTag(guild, channel, user) {
      if (!user) return;
      const { Permissions = {} } = constants || {};
      const computePermissions = safeFind(findByProps, "computePermissions", "canEveryoneRole")?.computePermissions;
      const guildMembers = safeFind(findByStoreName, "GuildMemberStore");
      let permissions = [];
      if (guild && typeof computePermissions === "function") {
        try {
          const perms = computePermissions({ user, context: guild, overwrites: channel?.permissionOverwrites });
          permissions = Object.entries(Permissions).filter(([, bit]) => {
            try { return Boolean(perms & bit); } catch { return false; }
          }).map(([name]) => name);
        } catch {}
      }
      const entries = [
        { text: "WEBHOOK", condition: () => !!user?.isNonUserBot?.() },
        { text: "OWNER", condition: () => guild?.ownerId === user.id },
        { text: "ADMIN", permissions: ["ADMINISTRATOR"] },
        { text: "STAFF", permissions: ["MANAGE_GUILD", "MANAGE_CHANNELS", "MANAGE_ROLES", "MANAGE_WEBHOOKS"] },
        { text: "MOD", permissions: ["MANAGE_MESSAGES", "KICK_MEMBERS", "BAN_MEMBERS"] },
        { text: "VC Mod", permissions: ["MOVE_MEMBERS", "MUTE_MEMBERS", "DEAFEN_MEMBERS"] },
        { text: "Chat Mod", permissions: ["MODERATE_MEMBERS"] }
      ];
      for (const tag of entries) {
        if (!(tag.condition?.() || (!user.bot && tag.permissions?.some(p => permissions.includes(p))))) continue;
        let roleColor;
        try { roleColor = storage.useRoleColor ? guildMembers?.getMember?.(guild?.id, user.id)?.colorString : undefined; } catch {}
        const backgroundColor = roleColor || "#5865f2";
        let lightness = 50;
        try { lightness = chroma(backgroundColor).get("lab.l"); } catch {}
        return {
          text: tag.text,
          backgroundColor,
          textColor: lightness < 70 ? (rawColors.WHITE_500 || "#ffffff") : (rawColors.BLACK_500 || "#161616"),
          verified: false
        };
      }
    }

    function startStaffTags() {
      const cleanups = [];
      const GuildStore = safeFind(findByStoreName, "GuildStore");
      const ChannelStore = safeFind(findByStoreName, "ChannelStore");
      const TagModule = safeFind(findByProps, "getBotLabel");
      const getTagProperties = safeFind(findByName, "getTagProperties", false);
      const DisplayName = safeFind(findByName, "DisplayName", false);
      const HeaderName = safeFind(findByName, "HeaderName", false);
      const processColor = ReactNative?.processColor;
      if (getTagProperties) {
        addCleanup(cleanups, after("default", getTagProperties, ([props], ret) => {
          const message = props?.message;
          if (!message || !ret || BUILT_IN_TAGS.includes(ret.tagText)) return;
          const channel = ChannelStore?.getChannel?.(message.channel_id);
          const guild = GuildStore?.getGuild?.(channel?.guild_id);
          const tag = getStaffTag(guild, channel, message.author);
          if (!tag) return;
          return {
            ...ret, tagText: tag.text,
            tagTextColor: processColor ? processColor(chroma(tag.textColor).hex()) : undefined,
            tagBackgroundColor: processColor ? processColor(chroma(tag.backgroundColor).hex()) : undefined,
            tagVerified: false, tagType: undefined
          };
        }));
      }
      if (HeaderName?.default) {
        addCleanup(cleanups, after("default", HeaderName, ([props], ret) => {
          if (ret?.props && props?.channelId) ret.props.channelId = props.channelId;
        }));
      }
      if (DisplayName?.default && TagModule?.default) {
        addCleanup(cleanups, after("default", DisplayName, ([{ guildId, channelId, user }], ret) => {
          if (!ret || !user) return;
          const existing = findInReactTree(ret, c => c?.type?.Types);
          if (existing && BUILT_IN_TAGS.includes(TagModule.getBotLabel?.(existing.props?.type))) return;
          const guild = GuildStore?.getGuild?.(guildId);
          const channel = ChannelStore?.getChannel?.(channelId);
          const tag = getStaffTag(guild, channel, user);
          if (!tag) return;
          if (existing) Object.assign(existing.props, { type: 0, text: tag.text, textColor: tag.textColor, backgroundColor: tag.backgroundColor, verified: false });
          else {
            const row = findInReactTree(ret, c => c?.props?.style?.flexDirection === "row");
            if (!row?.props) return;
            if (!Array.isArray(row.props.children)) row.props.children = [row.props.children];
            row.props.children.push(React.createElement(TagModule.default, { style: { marginLeft: 0 }, type: 0, text: tag.text, textColor: tag.textColor, backgroundColor: tag.backgroundColor, verified: false }));
          }
        }));
      }
      const TagComponent = safeFind(findByProps, "getBotLabel");
      if (TagComponent?.default) {
        addCleanup(cleanups, after("default", TagComponent, ([props], ret) => {
          const tag = props?.text;
          if (!tag || !MAX_TAGS.includes(tag) || !ret?.props) return;
          const label = findInReactTree(ret, c => typeof c?.props?.children === "string");
          if (!label?.props) return;
          if (props.textColor) label.props.style = [...(Array.isArray(label.props.style) ? label.props.style : [label.props.style].filter(Boolean)), { color: props.textColor }];
          if (props.backgroundColor) ret.props.style = [...(Array.isArray(ret.props.style) ? ret.props.style : [ret.props.style].filter(Boolean)), { backgroundColor: props.backgroundColor }];
          return ret;
        }));
      }
      return () => cleanup(cleanups);
    }

    function startNoType() {
      const cleanups = [];
      const typing = safeFind(findByProps, "startTyping");
      if (typing?.startTyping) addCleanup(cleanups, instead("startTyping", typing, () => {}));
      if (typing?.stopTyping) addCleanup(cleanups, instead("stopTyping", typing, () => {}));
      return () => cleanup(cleanups);
    }

    function startMiniMod() {
      const GuildMemberStore = safeFind(findByStoreName, "GuildMemberStore");
      const nativeProxy = globalThis.window?.nativeModuleProxy ?? globalThis.nativeModuleProxy;
      const chatModule = nativeProxy?.NativeChatModule ?? nativeProxy?.DCDChatManager;
      if (!chatModule || typeof chatModule.updateRows !== "function") {
        console.warn("[KiraUtils/MiniMod] Native chat row module was not found on this client.");
        return () => {};
      }
      return before("updateRows", chatModule, args => {
        try {
          const rows = JSON.parse(args[1]);
          if (!Array.isArray(rows) || !rows.some(row => row && "message" in row)) return;
          const timedOut = GuildMemberStore?.getCommunicationDisabledUserMap?.() ?? {};
          const now = Date.now();
          for (const row of rows) {
            if (row?.type !== 1 || !row?.message) continue;
            const expiresAt = new Date(timedOut[row.message.guildId + "-" + row.message.authorId]).getTime();
            if (Number.isFinite(expiresAt) && expiresAt > now) row.message.communicationDisabled = true;
          }
          args[1] = JSON.stringify(rows);
        } catch (error) { console.warn("[KiraUtils/MiniMod] Could not annotate timeout status.", error); }
      });
    }


    function startHideBlocked() {
      const patches = [];
      const filters = safeFind(findByProps, "isBlocked", "isIgnored");
      const rowManager = safeFind(findByName, "RowManager", false) || safeFind(findByName, "RowManager");
      storage.hideBlockedBlocked ??= true;
      storage.hideBlockedIgnored ??= true;
      storage.hideBlockedReplies ??= true;
      const filtered = id => {
        try { return !!id && ((storage.hideBlockedBlocked && filters?.isBlocked?.(id)) || (storage.hideBlockedIgnored && filters?.isIgnored?.(id))); }
        catch { return false; }
      };
      const skip = msg => !!msg && (filtered(msg.author?.id) || (storage.hideBlockedReplies && filtered(msg.referenced_message?.author?.id)));
      addCleanup(patches, before("dispatch", FluxDispatcher, args => {
        const e = args?.[0];
        if (!e) return;
        if (e.type === "LOAD_MESSAGES_SUCCESS" && Array.isArray(e.messages)) e.messages = e.messages.filter(m => !skip(m));
        if (["MESSAGE_CREATE", "MESSAGE_UPDATE"].includes(e.type) && skip(e.message)) e.channelId = "0";
      }));
      if (rowManager?.prototype && typeof rowManager.prototype.generate === "function") {
        addCleanup(patches, before("generate", rowManager.prototype, args => {
          const d = args?.[0];
          if (!d || !skip(d.message)) return;
          d.renderContentOnly = true;
          d.message.content = null;
          d.message.reactions = [];
          d.message.canShowComponents = false;
          if (d.rowType === 2) { d.roleStyle = ""; d.text = "[Filtered message. Check KiraUtils settings.]"; d.revealed = false; d.content = []; }
        }));
      }
      return () => cleanup(patches);
    }

    function startCopyBios() {
      const BioText = safeFind(findByName, "BioText", false);
      if (!BioText) { console.warn("[KiraUtils/CopyBios] BioText component is unavailable."); return () => {}; }
      const visit = node => {
        if (!node || typeof node !== "object") return;
        if (node.type === ReactNative?.Text && node.props) {
          node.props.selectable = true;
          if (typeof node.props.onPress !== "function") node.props.onPress = () => {};
        }
        const kids = node.props?.children;
        if (Array.isArray(kids)) kids.forEach(visit); else if (kids && typeof kids === "object") visit(kids);
      };
      return after("default", BioText, (_args, rendered) => {
        if (rendered?.props) { rendered.props.selectable = true; visit(rendered); }
        return rendered;
      });
    }

    function randomString(length) {
      const chars = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
      try {
        const bytes = globalThis.crypto?.getRandomValues?.(new Uint8Array(length));
        if (bytes) return Array.from(bytes, n => chars[n % chars.length]).join("");
      } catch {}
      return Array.from({ length }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
    }
    function anonymizeFile(file, length) {
      const target = file?.file ?? file;
      if (!target) return;
      const name = target.filename ?? target.name;
      if (typeof name !== "string") return;
      const dot = name.lastIndexOf(".");
      const ext = dot > 0 ? name.slice(dot) : "";
      const replacement = randomString(Math.max(1, Math.min(64, length))) + ext;
      if (typeof target.filename === "string") target.filename = replacement;
      if (typeof target.name === "string") target.name = replacement;
    }
    function startAnonymousFileNames() {
      storage.anonymousFilenameLength ??= "8";
      const patches = [];
      const upload = safeFind(findByProps, "uploadLocalFiles");
      if (typeof upload?.uploadLocalFiles === "function") {
        addCleanup(patches, before("uploadLocalFiles", upload, args => {
          const files = args?.[0]?.items ?? args?.[0]?.files ?? args?.[0]?.uploads;
          if (Array.isArray(files)) for (const file of files) anonymizeFile(file, Number.parseInt(storage.anonymousFilenameLength, 10) || 8);
        }));
      }
      ensureUploadWrapper();
      patches.push(() => reconcileUploadWrapper());
      return () => cleanup(patches);
    }

    function startSilentMessages() {
      const patches = [];
      const sender = safeFind(findByProps, "sendMessage");
      const channelStore = safeFind(findByProps, "getChannel");
      storage.silentAlways ??= false;
      storage.silentChannelIds ??= [];
      if (typeof sender?.sendMessage === "function") {
        addCleanup(patches, before("sendMessage", sender, args => {
          const channelId = String(args?.[0] ?? "");
          const msg = args?.[1];
          if (!msg || typeof msg.content !== "string" || msg.content.startsWith("@silent ")) return;
          let ids = [channelId];
          try { const c = channelStore?.getChannel?.(channelId); if (Array.isArray(c?.recipients)) ids.push(...c.recipients); } catch {}
          if (Array.isArray(msg.mentions)) ids.push(...msg.mentions.map(mention => mention?.id).filter(Boolean));
          ids = [...new Set(ids.map(id => String(id)))];
          if (storage.silentAlways || ids.some(id => (storage.silentChannelIds || []).includes(id))) msg.content = "@silent " + msg.content;
        }));
      }
      return () => cleanup(patches);
    }

    async function uploadCatbox(media) {
      const uri = media?.item?.originalUri || media?.uri || media?.fileUri || media?.path || media?.sourceURL;
      if (!uri) throw new Error("Missing file URI");
      const form = new FormData();
      form.append("reqtype", "fileupload");
      if (storage.catboxUserhash?.trim()) form.append("userhash", storage.catboxUserhash.trim());
      form.append("fileToUpload", { uri, name: String(media?.filename ?? "upload"), type: String(media?.mimeType ?? media?.type ?? "application/octet-stream") });
      const response = await fetch("https://catbox.moe/user/api.php", { method: "POST", body: form });
      const result = (await response.text()).trim();
      if (!response.ok || !/^https:\/\//i.test(result)) throw new Error(result || "Catbox upload failed");
      return result;
    }
    function ensureUploadWrapper() {
      const proto = safeFind(findByProps, "CloudUpload")?.CloudUpload?.prototype;
      if (!proto || typeof proto.reactNativeCompressAndExtractData !== "function") {
        console.warn("[KiraUtils/Uploads] CloudUpload was not found on this client.");
        return;
      }
      if (uploadPatchState.proto === proto && proto.reactNativeCompressAndExtractData === uploadPatchState.wrapper) return;
      const original = proto.reactNativeCompressAndExtractData;
      const replacement = async function (...args) {
        if (storage.toggle?.anonymousFileNames) {
          const length = Number.parseInt(storage.anonymousFilenameLength, 10) || 8;
          anonymizeFile(this, length);
          for (const arg of args) anonymizeFile(arg, length);
        }
        if (!storage.toggle?.catbox) return original.apply(this, args);
        const size = Number(this?.preCompressionSize ?? this?.size ?? 0);
        if (!storage.catboxAlwaysUpload && size <= 10 * 1024 * 1024) return original.apply(this, args);
        if (size > 200 * 1024 * 1024) { showToast("File is above 200 MB; using normal Discord upload."); return original.apply(this, args); }
        try {
          showToast("Uploading file to catbox.moe…");
          const url = await uploadCatbox(this);
          try { this.setStatus?.("CANCELED"); } catch {}
          const markdown = "[" + String(this?.filename ?? "file") + "](" + url + ")";
          const sender = safeFind(findByProps, "sendMessage");
          const channelStore = safeFind(findByProps, "getChannelId");
          const channelId = String(this?.channelId ?? channelStore?.getChannelId?.() ?? "");
          let delivered = false;
          if (storage.catboxInsert) {
            catboxPendingLink = markdown;
            showToast("Catbox link will be inserted into your next message.");
            delivered = true;
          }
          if (storage.catboxCopy && ReactNative?.Clipboard?.setString) {
            ReactNative.Clipboard.setString(markdown);
            showToast("Catbox link copied.");
            delivered = true;
          } else if (!storage.catboxInsert && channelId && typeof sender?.sendMessage === "function") {
            await sender.sendMessage(channelId, { content: markdown });
            showToast("Catbox link sent to chat.");
            delivered = true;
          }
          if (!delivered) showToast("Catbox upload complete: " + url);
          return null;
        } catch (error) {
          console.error("[KiraUtils/Catbox]", error);
          showToast("Catbox upload failed; falling back to Discord.");
          return original.apply(this, args);
        }
      };
      uploadPatchState.proto = proto;
      uploadPatchState.original = original;
      uploadPatchState.wrapper = replacement;
      proto.reactNativeCompressAndExtractData = replacement;
    }
    function reconcileUploadWrapper() {
      if (storage.toggle?.anonymousFileNames || storage.toggle?.catbox) {
        ensureUploadWrapper();
        return;
      }
      const state = uploadPatchState;
      if (state.proto && state.wrapper && state.proto.reactNativeCompressAndExtractData === state.wrapper) {
        state.proto.reactNativeCompressAndExtractData = state.original;
      }
      state.proto = null; state.original = null; state.wrapper = null; catboxPendingLink = null;
    }
    function startCatbox() {
      storage.catboxAlwaysUpload ??= false;
      storage.catboxCopy ??= true;
      storage.catboxInsert ??= false;
      storage.catboxUserhash ??= "";
      const patches = [];
      const sender = safeFind(findByProps, "sendMessage");
      if (typeof sender?.sendMessage === "function") {
        addCleanup(patches, before("sendMessage", sender, args => {
          if (!storage.toggle?.catbox || !catboxPendingLink || !args?.[1] || typeof args[1].content !== "string") return;
          args[1].content = args[1].content ? args[1].content + "\n" + catboxPendingLink : catboxPendingLink;
          catboxPendingLink = null;
        }));
      }
      ensureUploadWrapper();
      patches.push(() => { catboxPendingLink = null; reconcileUploadWrapper(); });
      return () => cleanup(patches);
    }

    function startHiddenChannels() {
      const patches = [];
      const permissionModule = safeFind(findByProps, "getChannelPermissions", "can") || safeFind(findByProps, "can", "initialize");
      const channels = safeFind(findByStoreName, "ChannelStore") || safeFind(findByProps, "getChannel");
      const viewChannel = constants?.Permissions?.VIEW_CHANNEL;
      const types = safeFind(findByProps, "ChannelTypes")?.ChannelTypes || {};
      storage.hiddenChannelsShowIcon ??= true;
      if (!permissionModule || typeof permissionModule.can !== "function" || viewChannel == null) {
        console.warn("[KiraUtils/HiddenChannels] Permission APIs were not found.");
        return () => {};
      }
      const isHidden = value => {
        const channel = typeof value === "string" ? channels?.getChannel?.(value) : value;
        if (!channel || !channel.id || (channel.guild_id ?? channel.guildId) == null) return false;
        if ([types.DM, types.GROUP_DM, types.GUILD_CATEGORY].some(type => type != null && channel.type === type)) return false;
        const old = channel.realCheck;
        channel.realCheck = true;
        let allowed = true;
        try { allowed = !!permissionModule.can(viewChannel, channel); } catch {}
        if (old === undefined) delete channel.realCheck; else channel.realCheck = old;
        return !allowed;
      };
      addCleanup(patches, after("can", permissionModule, ([permission, channel], result) => permission === viewChannel && !channel?.realCheck ? true : result));
      const ChannelInfo = safeFind(findByName, "ChannelInfo", false);
      if (ChannelInfo) addCleanup(patches, after("default", ChannelInfo, ([props], rendered) => {
        if (!storage.hiddenChannelsShowIcon || !props?.channel || !isHidden(props.channel)) return rendered;
        return React.createElement(React.Fragment, null,
          React.createElement(ReactNative.Image, { source: getAssetIDByName("ic_lock"), style: { width: 20, height: 20, marginRight: 4 } }),
          rendered
        );
      }));
      return () => cleanup(patches);
    }

    function startLocalEdit() {
      if (globalThis.__lesbunnyLocalEditPlugins?.remastered) {
        storage.toggle.localEdit = false;
        showToast("Standalone Local Edit is already enabled. Disable it to use KiraUtils Local Edit.");
        return () => {};
      }
      storage.localEdits ??= {};
      storage.localEditShowOwn ??= true;
      const patches = [];
      const menu = safeFind(findByProps, "openLazy", "hideActionSheet");
      const startActions = safeFind(findByProps, "startEditMessage");
      const editActions = safeFind(findByProps, "editMessage") || startActions;
      const messageStore = safeFind(findByStoreName, "MessageStore") || safeFind(findByProps, "getMessage", "getMessages");
      let pending = null, oldEdit = null, wrappedEdit = null, timer = null;
      const restore = () => {
        if (timer) clearTimeout(timer);
        timer = null;
        if (pending?.actions && oldEdit && pending.actions.editMessage === wrappedEdit) pending.actions.editMessage = oldEdit;
        pending = null; oldEdit = null; wrappedEdit = null;
      };
      const apply = msg => {
        if (!msg?.id) return msg;
        const saved = storage.localEdits[String(msg.id)];
        if (!saved) return msg;
        const cid = msg.channel_id ?? msg.channelId;
        return cid != null && saved.channelId && String(cid) !== String(saved.channelId) ? msg : { ...msg, content: saved.content };
      };
      const save = (msg, content) => {
        const id = String(msg?.id ?? ""), cid = String(msg?.channel_id ?? msg?.channelId ?? "");
        if (!id || !cid) return;
        const prior = storage.localEdits[id];
        storage.localEdits[id] = { channelId: cid, content, originalContent: prior ? prior.originalContent : (typeof msg.content === "string" ? msg.content : null) };
        FluxDispatcher.dispatch({ type: "MESSAGE_UPDATE", message: { id, channel_id: cid, content }, __kiraLocalEdit: true });
      };
      addCleanup(patches, before("dispatch", FluxDispatcher, args => {
        const e = args?.[0];
        if (!e || e.__kiraLocalEdit) return;
        if (pending && ["CLEAR_EDITING_MESSAGE", "CANCEL_EDITING_MESSAGE", "END_EDITING_MESSAGE"].includes(e.type)) {
          const expectedEdit = pending;
          setTimeout(() => { if (pending === expectedEdit) restore(); }, 50);
        }
        if (["MESSAGE_CREATE", "MESSAGE_UPDATE"].includes(e.type) && e.message) { const m = apply(e.message); if (m !== e.message) e.message = m; }
        if (Array.isArray(e.messages)) e.messages = e.messages.map(apply);
      }));
      const openEditor = msg => {
        if (typeof startActions?.startEditMessage !== "function" || typeof editActions?.editMessage !== "function") { showToast("Native edit composer is unavailable."); return; }
        restore();
        const id = String(msg?.id ?? ""), cid = String(msg?.channel_id ?? msg?.channelId ?? "");
        if (!id || !cid) return;
        pending = { id, cid, msg, actions: editActions };
        oldEdit = editActions.editMessage;
        wrappedEdit = function (...args) {
          const p = pending, channel = String(args?.[0] ?? ""), messageId = String(args?.[1] ?? "");
          if (!p || messageId !== p.id || (channel && channel !== p.cid)) return oldEdit.apply(this, args);
          const value = args?.[2], content = typeof value === "string" ? value : value?.content ?? value?.text ?? value?.value;
          if (typeof content !== "string") return oldEdit.apply(this, args);
          const target = p.msg;
          restore();
          save(target, content);
          try { FluxDispatcher.dispatch({ type: "CLEAR_EDITING_MESSAGE", channelId: cid, messageId: id }); } catch {}
          return Promise.resolve();
        };
        editActions.editMessage = wrappedEdit;
        timer = setTimeout(restore, 120000);
        try { startActions.startEditMessage(cid, id, String(storage.localEdits[id]?.content ?? msg.content ?? "")); }
        catch (error) { restore(); console.error("[KiraUtils/LocalEdit]", error); }
      };
      if (menu?.openLazy) addCleanup(patches, before("openLazy", menu, ([component, key, props]) => {
        if (typeof key !== "string" || !key.includes("MessageLongPress")) return;
        const msg = props?.message ?? props?.props?.message;
        if (!msg?.id) return;
        Promise.resolve(component).then(instance => {
          if (!instance) return;
          const target = typeof instance.default === "function" ? instance : typeof instance.default?.type === "function" ? instance.default : null;
          if (!target) return;
          const prop = target === instance ? "default" : "type";
          let unpatch;
          unpatch = after(prop, target, (_args, rendered) => {
            const rows = findInReactTree(rendered, n => Array.isArray(n) && n.some(r => r?.props && (typeof r.props.onPress === "function" || typeof r.props.onPressRow === "function")));
            if (!rows || rows.some(r => r?.key === "kira-local-edit")) return rendered;
            const me = safeFind(findByStoreName, "UserStore")?.getCurrentUser?.();
            if (me?.id != null && String(me.id) === String(msg.author?.id ?? msg.authorId) && !storage.localEditShowOwn) return rendered;
            const template = rows.find(r => r?.props && (typeof r.props.onPress === "function" || typeof r.props.onPressRow === "function"));
            if (!template) return rendered;
            const click = () => { try { menu.hideActionSheet?.(); } catch {} openEditor(msg); };
            let icon = template.props?.icon;
            try {
              const Icon = safeFind(findByProps, "ActionSheetRow")?.ActionSheetRow?.Icon, asset = getAssetIDByName("ic_edit_24px");
              if (Icon && asset != null) icon = React.createElement(Icon, { source: asset });
            } catch {}
            const row = React.cloneElement(template, { key: "kira-local-edit", label: "Edit Locally", message: "Edit Locally", text: "Edit Locally", icon, onPress: click, onPressRow: click, action: click });
            const findIndex = re => rows.findIndex(r => re.test(String(r?.props?.label ?? r?.props?.message ?? r?.props?.text ?? r?.props?.title ?? "")));
            const reply = findIndex(/\breply\b/i), forward = findIndex(/\bforward\b/i), unread = findIndex(/mark unread/i);
            const indexes = [reply, forward].filter(i => i >= 0);
            rows.splice(indexes.length ? Math.min(...indexes) : unread >= 0 ? unread : rows.length, 0, row);
            return rendered;
          });
          patches.push(() => unpatch?.());
        }).catch(error => console.warn("[KiraUtils/LocalEdit] Menu patch failed.", error));
      }));
      for (const [id, edit] of Object.entries(storage.localEdits)) {
        try { if (messageStore?.getMessage?.(edit.channelId, id)) FluxDispatcher.dispatch({ type: "MESSAGE_UPDATE", message: { id, channel_id: edit.channelId, content: edit.content }, __kiraLocalEdit: true }); } catch {}
      }
      return () => { restore(); cleanup(patches); };
    }

    function settingSwitch(title, key, callback) {
      return React.createElement(ReactNative.Pressable, {
        key, onPress: callback,
        style: { paddingVertical: 10, paddingHorizontal: 12, borderRadius: 12, backgroundColor: "#191621", borderWidth: 1, borderColor: "#433951", marginBottom: 7 }
      }, React.createElement(ReactNative.Text, { style: { color: "#f5efff", fontWeight: "700" } }, title));
    }

    function setFeature(id, value) {
      storage.toggle[id] = !!value;
      if (featureCleanups[id]) { try { featureCleanups[id](); } catch {} delete featureCleanups[id]; }
      if (!value || !enabled) return;
      try {
        if (id === "staffTags") featureCleanups[id] = startStaffTags();
        if (id === "tenorGifFix") featureCleanups[id] = startTenorFix();
        if (id === "notype") featureCleanups[id] = startNoType();
        if (id === "minimod") featureCleanups[id] = startMiniMod();
        if (id === "hideBlocked") featureCleanups[id] = startHideBlocked();
        if (id === "copyBios") featureCleanups[id] = startCopyBios();
        if (id === "catbox") featureCleanups[id] = startCatbox();
        if (id === "silentMessages") featureCleanups[id] = startSilentMessages();
        if (id === "anonymousFileNames") featureCleanups[id] = startAnonymousFileNames();
        if (id === "hiddenChannels") featureCleanups[id] = startHiddenChannels();
        if (id === "localEdit") featureCleanups[id] = startLocalEdit();
      } catch (error) {
        console.warn("[KiraUtils] Could not enable " + id, error);
      }
    }


    function Settings() {
      try { vendetta.storage.useProxy(storage); } catch {}
      const [, refresh] = React.useState(0);
      const [silentIdInput, setSilentIdInput] = React.useState("");
      const [userhashInput, setUserhashInput] = React.useState(storage.catboxUserhash || "");
      const [filenameLength, setFilenameLength] = React.useState(String(storage.anonymousFilenameLength || "8"));
      const { ScrollView, View, Text, Pressable, TextInput } = ReactNative;
      const rerender = () => refresh(n => n + 1);
      const label = (value, style = {}) => React.createElement(Text, { style: { color: "#f5efff", ...style } }, value);
      const group = (title, subtitle, children) => React.createElement(View, {
        key: title, style: { padding: 15, marginBottom: 14, borderRadius: 20, backgroundColor: "#211d2c", borderWidth: 1, borderColor: "#51465f" }
      },
        label(title, { fontSize: 14, fontWeight: "900", color: "#cbb7ff", letterSpacing: .6, marginBottom: 4 }),
        subtitle ? label(subtitle, { fontSize: 12, lineHeight: 17, color: "#a99fbc", marginBottom: 12 }) : null,
        ...children
      );
      const toggle = (id, title, detail) => React.createElement(Pressable, {
        key: id, onPress: () => { setFeature(id, !storage.toggle[id]); rerender(); },
        style: { paddingVertical: 11, paddingHorizontal: 12, borderRadius: 13, backgroundColor: storage.toggle[id] ? "#372c4c" : "#191621", borderWidth: 1, borderColor: storage.toggle[id] ? "#8d77b5" : "#3f364c", marginBottom: 8 }
      },
        React.createElement(View, { style: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 } },
          label(title, { fontWeight: "800", flex: 1 }),
          label(storage.toggle[id] ? "ON" : "OFF", { color: storage.toggle[id] ? "#d2c0ff" : "#a99fbc", fontSize: 11, fontWeight: "900" })
        ),
        detail ? label(detail, { color: "#b9afcc", fontSize: 12, lineHeight: 17, marginTop: 4 }) : null
      );
      const subToggle = (title, key) => settingSwitch(title + ": " + (storage[key] ? "ON" : "OFF"), key, () => { storage[key] = !storage[key]; rerender(); });
      const input = (placeholder, value, onChange, keyboardType) => TextInput ? React.createElement(TextInput, {
        value, onChangeText: onChange, placeholder, placeholderTextColor: "#988eab", keyboardType,
        style: { color: "#f5efff", borderRadius: 11, borderWidth: 1, borderColor: "#51465f", padding: 10, marginBottom: 8, backgroundColor: "#191621" }
      }) : null;
      const chips = (ids, remove) => React.createElement(View, { style: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 8 } },
        ...ids.map(id => React.createElement(Pressable, {
          key: id, onPress: () => remove(id),
          style: { paddingVertical: 5, paddingHorizontal: 9, borderRadius: 9, backgroundColor: "#3b304e", borderWidth: 1, borderColor: "#635278" }
        }, label(String(id) + "  ×", { fontSize: 11, color: "#dfd3f5" })))
      );
      const localEdits = storage.localEdits || {};
      const roleColor = React.createElement(Pressable, {
        onPress: () => { storage.useRoleColor = !storage.useRoleColor; rerender(); },
        style: { padding: 10, borderRadius: 12, backgroundColor: "#191621", marginBottom: 6 }
      }, label("Use top role color: " + (storage.useRoleColor ? "ON" : "OFF"), { fontWeight: "700" }));
      return React.createElement(ScrollView, { contentContainerStyle: { padding: 14, paddingBottom: 28 } },
        label("KiraUtils", { fontSize: 26, fontWeight: "900", letterSpacing: -0.5, marginBottom: 4 }),
        label("One tidy toolbox for message privacy, uploads, profile details and local editing. Feature switches take effect immediately, in the NexxUtils-style grouped settings layout.", { color: "#c9bfd9", fontSize: 13, lineHeight: 20, marginBottom: 18 }),
        group("MESSAGES & PRIVACY", "Control what is shown and how messages are sent.", [
          toggle("hideBlocked", "Hide blocked / ignored messages", "Hide filtered content and optionally hide replies to filtered users."),
          storage.toggle.hideBlocked ? React.createElement(View, { key: "blocked-options", style: { paddingLeft: 8, marginBottom: 7 } },
            subToggle("Filter messages from blocked users", "hideBlockedBlocked"),
            subToggle("Filter messages from ignored users", "hideBlockedIgnored"),
            subToggle("Filter replies to blocked / ignored users", "hideBlockedReplies")
          ) : null,
          toggle("silentMessages", "Silent Messages", "Prefix messages with @silent globally or in selected direct messages."),
          storage.toggle.silentMessages ? React.createElement(View, { key: "silent-options", style: { paddingLeft: 8, marginBottom: 8 } },
            subToggle("Always send silently", "silentAlways"),
            label("Silent channel / user IDs", { fontSize: 12, color: "#c9bfd9", marginTop: 4, marginBottom: 6 }),
            input("Paste a Discord ID", silentIdInput, setSilentIdInput, "numeric"),
            settingSwitch("Add ID to silent list", "silent-add", () => {
              const id = silentIdInput.trim();
              if (/^\d{17,20}$/.test(id) && !(storage.silentChannelIds || []).includes(id)) storage.silentChannelIds = [...(storage.silentChannelIds || []), id];
              setSilentIdInput(""); rerender();
            }),
            chips(storage.silentChannelIds || [], id => { storage.silentChannelIds = storage.silentChannelIds.filter(x => x !== id); rerender(); })
          ) : null
        ]),
        group("UPLOAD TOOLS", "File sharing helpers and privacy-aware upload options.", [
          toggle("catbox", "catbox.moe", "Upload files over 10 MB to Catbox, then copy or send a link. Larger than 200 MB falls back to Discord upload."),
          storage.toggle.catbox ? React.createElement(View, { key: "catbox-options", style: { paddingLeft: 8, marginBottom: 8 } },
            subToggle("Always upload files to Catbox", "catboxAlwaysUpload"),
            subToggle("Copy link instead of sending it", "catboxCopy"),
            subToggle("Insert link into the next message", "catboxInsert"),
            label("Optional Catbox userhash", { fontSize: 12, color: "#c9bfd9", marginTop: 4, marginBottom: 6 }),
            input("Catbox userhash (optional)", userhashInput, value => { setUserhashInput(value); storage.catboxUserhash = value; })
          ) : null,
          toggle("anonymousFileNames", "Anonymous File Names", "Randomise file names when uploading, preserving the extension."),
          storage.toggle.anonymousFileNames ? React.createElement(View, { key: "anon-options", style: { paddingLeft: 8, marginBottom: 8 } },
            label("Random filename length", { fontSize: 12, color: "#c9bfd9", marginTop: 4, marginBottom: 6 }),
            input("8", filenameLength, value => { const v = value.replace(/[^0-9]/g, "").slice(0, 2); setFilenameLength(v); storage.anonymousFilenameLength = v || "8"; }, "numeric")
          ) : null
        ]),
        group("PROFILE & CHANNELS", "Copy profile text or inspect channels your permissions hide.", [
          toggle("copyBios", "Copy Bios", "Make profile bio text selectable for normal copying."),
          toggle("hiddenChannels", "Hidden Channels", "Permit viewing channels hidden by VIEW_CHANNEL permissions. Use responsibly."),
          storage.toggle.hiddenChannels ? subToggle("Show lock icon on hidden channels", "hiddenChannelsShowIcon") : null
        ]),
        group("FIXES & SMALL UTILITIES", "Standalone modules inspired by NexxUtils.", [
          toggle("notype", "No Type", "Suppress the typing indicator for your account."),
          toggle("staffTags", "Staff Tags", "Show owner, admin, staff and moderator tags."),
          storage.toggle.staffTags ? roleColor : null,
          toggle("tenorGifFix", "Tenor GIF Fix", "Prefer Tenor GIF files over MP4 videos when downloading or sharing."),
          toggle("minimod", "MiniMod", "Show timeout status indicators in chat rows.")
        ]),
        group("LOCAL EDITING", "These changes affect only your local display; they never edit a server message.", [
          toggle("localEdit", "Local Edit", "Use Discord's normal edit composer, but intercept Save to store the new text locally."),
          storage.toggle.localEdit ? React.createElement(View, { key: "local-edit-options", style: { paddingLeft: 8, marginBottom: 8 } },
            subToggle("Show Edit Locally on my own messages", "localEditShowOwn"),
            label("Saved local edits: " + Object.keys(localEdits).length, { color: "#c9bfd9", fontSize: 12, marginBottom: 8 }),
            settingSwitch("Clear every local edit", "clear-local-edits", () => {
              for (const [id, edit] of Object.entries(localEdits)) {
                if (edit.originalContent !== null) {
                  try { FluxDispatcher.dispatch({ type: "MESSAGE_UPDATE", message: { id, channel_id: edit.channelId, content: edit.originalContent }, __kiraLocalEdit: true }); } catch {}
                }
              }
              storage.localEdits = {}; rerender();
            })
          ) : null
        ]),
        group("ABOUT", "Third-party modules retain their original authorship and licensing.", [
          label("KiraUtils integrates original AzzyUtils features plus Hide Blocked/ignored, CopyBios, catbox.moe, Silent Messages, AnonymousFileNames, Hidden Channels and Local Edit.", { fontSize: 12, color: "#a99fbc", lineHeight: 18 }),
          label("Source, credits and licenses: github.com/lesbunny/Discord-Plugins", { fontSize: 12, color: "#cbb7ff", marginTop: 8 })
        ])
      );
    }

    function load() {
      storage.toggle ??= {};
      storage.toggle.notype ??= false;
      storage.toggle.staffTags ??= false;
      storage.toggle.tenorGifFix ??= false;
      storage.toggle.minimod ??= false;
      for (const id of ["hideBlocked","copyBios","catbox","silentMessages","anonymousFileNames","hiddenChannels","localEdit"]) storage.toggle[id] ??= false;
      storage.hideBlockedBlocked ??= true;
      storage.hideBlockedIgnored ??= true;
      storage.hideBlockedReplies ??= true;
      storage.silentAlways ??= false;
      storage.silentChannelIds ??= [];
      storage.catboxAlwaysUpload ??= false;
      storage.catboxCopy ??= true;
      storage.catboxInsert ??= false;
      storage.catboxUserhash ??= "";
      storage.anonymousFilenameLength ??= "8";
      storage.localEdits ??= {};
      storage.localEditShowOwn ??= true;
      storage.useRoleColor ??= false;
      enabled = true;
      globalThis.__kiraUtilsLive = { setFeature };
      for (const id of ["notype", "staffTags", "tenorGifFix", "minimod", "hideBlocked", "copyBios", "catbox", "silentMessages", "anonymousFileNames", "hiddenChannels", "localEdit"]) if (storage.toggle[id]) setFeature(id, true);
    }
    function unload() {
      enabled = false;
      if (globalThis.__kiraUtilsLive?.setFeature === setFeature) delete globalThis.__kiraUtilsLive;
      for (const id of Object.keys(featureCleanups)) { try { featureCleanups[id](); } catch {} delete featureCleanups[id]; }
    }
    return { onLoad: load, onUnload: unload, settings: Settings };
  })()
})