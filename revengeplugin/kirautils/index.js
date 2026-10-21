({
  default: (() => {
    const { findByProps, findByName, findByStoreName, findByTypeNameAll } = vendetta.metro;
    const { React, ReactNative, chroma, constants } = vendetta.metro.common;
    const { before, after, instead } = vendetta.patcher;
    const { storage } = vendetta.plugin;
    const { findInReactTree } = vendetta.utils;
    const rawColors = vendetta.ui.rawColors || {};
    const MAX_TAGS = ["WEBHOOK", "OWNER", "ADMIN", "STAFF", "MOD", "VC Mod", "Chat Mod"];
    const Messages = vendetta.metro.common.i18n?.Messages || {};
    const BUILT_IN_TAGS = [Messages.AI_TAG, Messages.BOT_TAG_BOT, Messages.BOT_TAG_SERVER, Messages.SYSTEM_DM_TAG_SYSTEM, Messages.GUILD_AUTOMOD_USER_BADGE_TEXT, Messages.REMIXING_TAG].filter(Boolean);
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
      try {
        const u = new URL(url);
        if (!u.hostname.endsWith(".tenor.com")) return;
        const parts = u.pathname.split("/").filter(Boolean);
        if (parts.length < 2) return;
        const id = parts[0], file = parts[1];
        if (!id || !file) return;
        const baseId = id.slice(0, -2) + "AC";
        return "https://" + u.hostname + "/" + baseId + "/" + file.split(".")[0] + ".gif";
      } catch { return; }
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

    function setFeature(id, value) {
      storage.toggle[id] = !!value;
      if (featureCleanups[id]) { try { featureCleanups[id](); } catch {} delete featureCleanups[id]; }
      if (!value || !enabled) return;
      try {
        if (id === "staffTags") featureCleanups[id] = startStaffTags();
        if (id === "tenorGifFix") featureCleanups[id] = startTenorFix();
        if (id === "notype") featureCleanups[id] = startNoType();
      } catch (error) {
        console.warn("[KiraUtils] Could not enable " + id, error);
      }
    }

    function Settings() {
      try { vendetta.storage.useProxy(storage); } catch {}
      const [, refresh] = React.useState(0);
      const rerender = () => refresh(n => n + 1);
      const { ScrollView, View, Text, Pressable } = ReactNative;
      const label = (value, style = {}) => React.createElement(Text, { style: { color: "#f5efff", ...style } }, value);
      const toggle = (id, title, detail) => React.createElement(Pressable, {
        key: id, onPress: () => { setFeature(id, !storage.toggle[id]); rerender(); },
        style: { padding: 14, backgroundColor: "#302a40", borderRadius: 14, borderWidth: 1, borderColor: "#51465f", marginBottom: 9 }
      }, label(title + ": " + (storage.toggle[id] ? "ON" : "OFF"), { fontWeight: "800", marginBottom: 4 }),
         label(detail, { color: "#c9bfd9", fontSize: 12, lineHeight: 17 }));
      const roleColor = React.createElement(Pressable, {
        onPress: () => { storage.useRoleColor = !storage.useRoleColor; rerender(); },
        style: { padding: 12, marginBottom: 12, borderRadius: 12, backgroundColor: "#211d2c" }
      }, label("Use top role color: " + (storage.useRoleColor ? "ON" : "OFF")));
      return React.createElement(ScrollView, { contentContainerStyle: { padding: 16 } },
        label("KiraUtils", { fontSize: 25, fontWeight: "900", marginBottom: 4 }),
        label("A curated set of local client utilities. All feature switches apply immediately and are removed when the plugin is disabled.", { color: "#c9bfd9", lineHeight: 20, marginBottom: 18 }),
        toggle("notype", "No Type", "Suppress the typing indicator for your account."),
        toggle("staffTags", "Staff Tags", "Show permission-based tags in message and user name rows."),
        storage.toggle.staffTags ? roleColor : null,
        toggle("tenorGifFix", "Tenor GIF Fix", "Use the GIF rendition for supported Tenor downloads instead of video files."),
        label("History / logs are not part of KiraUtils. Use AntiEd or AntiEd Zero for persistent local edit history.", { color: "#a99fbc", fontSize: 12, marginTop: 16 })
      );
    }

    function load() {
      storage.toggle ??= {};
      storage.toggle.notype ??= false;
      storage.toggle.staffTags ??= false;
      storage.toggle.tenorGifFix ??= false;
      storage.useRoleColor ??= false;
      enabled = true;
      globalThis.__kiraUtilsLive = { setFeature };
      for (const id of ["notype", "staffTags", "tenorGifFix"]) if (storage.toggle[id]) setFeature(id, true);
    }
    function unload() {
      enabled = false;
      if (globalThis.__kiraUtilsLive?.setFeature === setFeature) delete globalThis.__kiraUtilsLive;
      for (const id of Object.keys(featureCleanups)) { try { featureCleanups[id](); } catch {} delete featureCleanups[id]; }
    }
    return { onLoad: load, onUnload: unload, settings: Settings };
  })()
})