({
  default: (() => {
    const v = vendetta;
    const { findByProps, findByStoreName } = v.metro;
    const { FluxDispatcher, React, ReactNative } = v.metro.common;
    const { before, after, instead } = v.patcher;
    const { storage } = v.plugin;
    const { getAssetIDByName } = v.ui.assets;
    const { findInReactTree } = v.utils;
    const patches = [];
    const snapshots = new Map();
    let activeEdit = null;
    storage.localEdits ??= {};

    const safeFind = (fn, ...args) => {
      try { return typeof fn === "function" ? fn(...args) : null; } catch { return null; }
    };
    const sheet = safeFind(findByProps, "openLazy", "hideActionSheet") ||
      safeFind(findByProps, "open", "hide");
    const messages = safeFind(findByProps, "startEditMessage", "editMessage") ||
      safeFind(findByProps, "editMessage");
    const store = safeFind(findByStoreName, "MessageStore") ||
      safeFind(findByProps, "getMessage", "getMessages");
    const userStore = safeFind(findByStoreName, "UserStore") ||
      safeFind(findByProps, "getCurrentUser");
    const rowModule = safeFind(findByProps, "ActionSheetRow") ||
      safeFind(findByProps, "DefaultActionSheetRow");
    const Forms = (v.ui && v.ui.components && v.ui.components.Forms) || {};
    const Row = (rowModule && (rowModule.ActionSheetRow || rowModule.DefaultActionSheetRow)) || Forms.FormRow;
    const RN = ReactNative || {};
    const { View, Text, Pressable, ScrollView } = RN;

    const edits = () => (storage.localEdits ??= {});
    const getEdit = id => edits()[String(id)];
    const cloneContent = (message, content) => {
      if (!message || typeof message !== "object") return message;
      try {
        return Object.assign(Object.create(Object.getPrototypeOf(message)), message, {
          content, edited_timestamp: null
        });
      } catch {
        return { ...message, content, edited_timestamp: null };
      }
    };
    const displayMessage = (message, channelId) => {
      if (!message || message.id == null) return message;
      const edit = getEdit(message.id);
      if (!edit) return message;
      if (channelId != null && edit.channelId && String(channelId) !== edit.channelId) return message;
      return cloneContent(message, edit.content);
    };
    const clearEdit = id => {
      id = String(id);
      const old = getEdit(id);
      if (!old) return;
      delete edits()[id];
      try {
        const current = store && store.getMessage && store.getMessage(old.channelId, id);
        FluxDispatcher && FluxDispatcher.dispatch && FluxDispatcher.dispatch({
          type: "MESSAGE_UPDATE",
          message: {
            ...(current || {}),
            id,
            channel_id: old.channelId,
            content: old.originalContent,
            edited_timestamp: null
          }
        });
      } catch (e) {
        console.warn("[localedit] Could not refresh the message after clearing its edit.", e);
      }
    };

    function findRows(tree) {
      if (typeof findInReactTree !== "function") return null;
      const isRow = node => {
        const props = node && node.props;
        if (!props) return false;
        const label = props.label || props.message || props.title || props.accessibilityLabel;
        const hasHandler = typeof props.onPress === "function" ||
          typeof props.onPressRow === "function" || typeof props.onClick === "function";
        if (typeof label !== "string" || !hasHandler) return false;
        const type = node.type;
        return type === Row || (type && (type.name === "ActionSheetRow" || type.displayName === "ActionSheetRow")) ||
          /^(reply|copy|copy text|copy message link|mark unread|delete|pin message|add reaction)$/i.test(label);
      };
      try { return findInReactTree(tree, node => Array.isArray(node) && node.some(isRow)) || null; }
      catch { return null; }
    }

    function startLocalEdit(message) {
      const channelId = String((message && (message.channel_id || message.channelId)) || "");
      const messageId = String((message && message.id) || "");
      if (!channelId || !messageId) return;
      const prior = getEdit(messageId);
      snapshots.set(messageId, {
        channelId,
        originalContent: prior ? prior.originalContent : String(message.content || "")
      });
      activeEdit = { channelId, messageId };
      try { sheet && sheet.hideActionSheet && sheet.hideActionSheet(); } catch {}
      try {
        if (messages && typeof messages.startEditMessage === "function") {
          messages.startEditMessage(channelId, messageId, String(message.content || ""));
        } else if (messages && typeof messages.openEditBox === "function") {
          messages.openEditBox(channelId, messageId, String(message.content || ""));
        } else {
          activeEdit = null;
          console.warn("[localedit] Native message editor was not found on this Discord build.");
        }
      } catch (e) {
        activeEdit = null;
        console.error("[localedit] Could not open message editor.", e);
      }
    }

    function patchMessageStore() {
      if (!store) return;
      if (typeof store.getMessage === "function") {
        patches.push(after("getMessage", store, (args, result) =>
          displayMessage(result, args && args[0] != null ? args[0] : result && result.channel_id)));
      }
      if (typeof store.getMessages === "function") {
        patches.push(after("getMessages", store, (_args, result) => {
          try {
            if (Array.isArray(result)) return result.map(m => displayMessage(m));
            const key = Array.isArray(result && result._array) ? "_array" :
              Array.isArray(result && result.array) ? "array" : null;
            if (!key) return result;
            const copy = Object.assign(Object.create(Object.getPrototypeOf(result)), result);
            copy[key] = result[key].map(m => displayMessage(m));
            return copy;
          } catch (e) {
            console.warn("[localedit] Could not overlay edited messages.", e);
            return result;
          }
        }));
      }
    }

    function patchEditor() {
      if (!messages || typeof messages.editMessage !== "function" || typeof instead !== "function") {
        console.warn("[localedit] Message edit function unavailable; local edit interception was not installed.");
        return;
      }
      patches.push(instead("editMessage", messages, (args, original) => {
        if (!activeEdit) return original(...args);
        const active = activeEdit;
        const arg0 = args && args[0], arg1 = args && args[1], arg2 = args && args[2];
        const candidateId = (arg1 != null && (typeof arg1 === "string" || typeof arg1 === "number"))
          ? String(arg1)
          : String((arg0 && (arg0.messageId || arg0.message_id || arg0.id)) || (arg2 && arg2.id) || "");
        if (!candidateId || candidateId !== active.messageId) return original(...args);
        const content = typeof arg2 === "string" ? arg2 :
          (arg2 && typeof arg2.content === "string") ? arg2.content :
          (arg0 && typeof arg0.content === "string") ? arg0.content : undefined;
        if (typeof content !== "string") {
          console.warn("[localedit] Edit request content shape was not recognized.");
          activeEdit = null;
          snapshots.delete(candidateId);
          return original(...args);
        }
        const current = store && store.getMessage ? store.getMessage(active.channelId, candidateId) : null;
        const previous = getEdit(candidateId);
        const snapshot = snapshots.get(candidateId);
        const originalContent = previous ? previous.originalContent :
          (snapshot ? snapshot.originalContent : String(current && current.content || ""));
        edits()[candidateId] = { channelId: active.channelId, content, originalContent };
        try {
          FluxDispatcher && FluxDispatcher.dispatch && FluxDispatcher.dispatch({
            type: "MESSAGE_UPDATE",
            message: {
              ...(current || {}),
              id: candidateId,
              channel_id: active.channelId,
              content,
              edited_timestamp: null,
              editedTimestamp: null
            },
            otherPluginBypass: true,
            log_edit: false
          });
        } catch (e) {
          console.warn("[localedit] Saved local edit but could not refresh message store.", e);
        }
        activeEdit = null;
        snapshots.delete(candidateId);
        return undefined;
      }));
      if (messages.endEditMessage && typeof after === "function") {
        patches.push(after("endEditMessage", messages, () => { activeEdit = null; }));
      }
    }

    function patchActionSheet() {
      if (!sheet || typeof sheet.openLazy !== "function" || !Row ||
          typeof before !== "function" || typeof after !== "function") {
        console.warn("[localedit] Action sheet modules are unavailable; context-menu action was not installed.");
        return;
      }
      patches.push(before("openLazy", sheet, ([component, key, props]) => {
        const keyText = String(key || "").toLowerCase();
        if (!(keyText.includes("message") && keyText.includes("actionsheet"))) return;
        const message = (props && (props.message ||
          (props.target && props.target.message) ||
          (props.actionMessage && props.actionMessage.message) ||
          (props.messageProps && props.messageProps.message))) || props;
        if (!message || !message.id || !(message.channel_id || message.channelId)) return;
        if (!component || typeof component.then !== "function") return;
        component.then(instance => {
          if (!instance || typeof instance.default !== "function") return;
          let removePatch;
          removePatch = after("default", instance, (_renderArgs, rendered) => {
            if (removePatch) { setTimeout(removePatch, 0); removePatch = null; }
            try {
              const rows = findRows(rendered);
              if (!rows || rows.some(row => {
                const label = row && row.props && (row.props.label || row.props.message);
                return String(label || "").toLowerCase() === "edit locally";
              })) return rendered;
              const currentUser = userStore && userStore.getCurrentUser && userStore.getCurrentUser();
              const currentMessage = store && store.getMessage
                ? (store.getMessage(message.channel_id || message.channelId, message.id) || message)
                : message;
              if (!currentUser || (currentMessage.author && currentMessage.author.id === currentUser.id)) return rendered;
              const replyIndex = rows.findIndex(row => {
                const label = row && row.props && (row.props.label || row.props.message);
                return /reply/i.test(String(label || ""));
              });
              const position = replyIndex >= 0 ? replyIndex + 1 : 0;
              const asset = safeFind(getAssetIDByName, "ic_edit_24px");
              const Icon = Row.Icon;
              const icon = Icon && asset ? React.createElement(Icon, { source: asset }) : undefined;
              const onEdit = () => startLocalEdit(currentMessage);
              rows.splice(position, 0, React.createElement(Row, {
                key: "localedit-" + String(currentMessage.id),
                label: "Edit Locally",
                message: "Edit Locally",
                icon,
                leading: icon,
                iconSource: asset,
                onPress: onEdit,
                onPressRow: onEdit
              }));
            } catch (e) { console.error("[localedit] Failed to inject context-menu action.", e); }
            return rendered;
          });
        }).catch(e => console.warn("[localedit] Could not load action sheet.", e));
      }));
    }

    function Settings() {
      const [, refresh] = React.useState(0);
      const entries = Object.entries(edits());
      const create = (type, style, children) => React.createElement(type, { style }, children);
      return React.createElement(ScrollView, { contentContainerStyle: { padding: 16 } },
        create(Text, { fontSize: 23, fontWeight: "700", color: "#e8ddff", marginBottom: 8 }, "Local Edit Remastered"),
        create(Text, { color: "#c8bfd8", marginBottom: 16, lineHeight: 20 },
          "Only your client sees these edits. They are stored locally and are never sent as Discord message edits."),
        create(Text, { color: "#e8ddff", fontWeight: "600", marginBottom: 12 },
          "Saved local edits: " + entries.length),
        ...entries.map(([id, edit]) => React.createElement(View, {
          key: id, style: { backgroundColor: "#30283f", borderRadius: 14, padding: 14, marginBottom: 10 }
        },
          React.createElement(Text, { style: { color: "#c2a6ff", fontSize: 12, marginBottom: 6 } }, "Message ID: " + id),
          React.createElement(Text, { style: { color: "#f4efff", marginBottom: 12 }, numberOfLines: 3 }, edit.content || "(empty message)"),
          React.createElement(Pressable, {
            onPress: () => { clearEdit(id); refresh(n => n + 1); },
            style: { alignSelf: "flex-start", backgroundColor: "#584672", borderRadius: 20, paddingVertical: 8, paddingHorizontal: 14 }
          }, React.createElement(Text, { style: { color: "#fff", fontWeight: "600" } }, "Clear local edit"))
        )),
        entries.length ? null : create(Text, { color: "#a99fbb", fontStyle: "italic" },
          "No local edits yet. Long-press a message from someone else and choose Edit Locally.")
      );
    }

    return {
      onLoad() {
        patchMessageStore();
        patchEditor();
        patchActionSheet();
        console.log("[localedit] Loaded. Changes stay on this device.");
      },
      onUnload() {
        patches.splice(0).forEach(unpatch => { try { unpatch(); } catch {} });
        activeEdit = null;
        snapshots.clear();
      },
      settings: Settings
    };
  })()
})