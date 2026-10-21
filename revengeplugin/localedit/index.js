({
  default: (() => {
    const { findByProps, findByStoreName } = vendetta.metro;
    const { React, ReactNative, FluxDispatcher } = vendetta.metro.common;
    const { before, after } = vendetta.patcher;
    const { storage } = vendetta.plugin;
    const { findInReactTree } = vendetta.utils;
    const { getAssetIDByName } = vendetta.ui.assets || {};
    const log = vendetta.logger || console;
    const { View, Text, ScrollView, Pressable } = ReactNative || {};
    storage.localEdits ??= {};
    storage.showOwnMessageAction ??= true;
    storage.clearEditsOnRestart ??= false;
    const sessionId = globalThis.__localEditSessionId ??=
      `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    if (storage.clearEditsOnRestart && storage.sessionId && storage.sessionId !== sessionId) {
      storage.localEdits = {};
    }
    storage.sessionId = sessionId;
    const patches = [];
    let enabled = false;
    let MessageStore, UserStore, ActionSheet, MessageActions;
    let pendingNativeEdit = null, originalNativeEditMessage = null, wrappedNativeEditMessage = null, nativeEditTimeout = null;

    const safeFind = (fn, ...args) => {
      try { return typeof fn === "function" ? fn(...args) : null; } catch { return null; }
    };
    const findSingleExport = prop => {
      try {
        const finder = vendetta.metro && vendetta.metro.find;
        const mod = typeof finder === "function" ? finder(m => m && m[prop] && Object.keys(m).length === 1) : null;
        if (mod && mod[prop]) return mod[prop];
      } catch {}
      const mod = safeFind(findByProps, prop);
      return mod && mod[prop] || null;
    };
    const edits = () => (storage.localEdits ??= {});
    const getEdit = id => edits()[String(id)];

    function dispatchContent(id, channelId, content) {
      try {
        FluxDispatcher.dispatch({
          type: "MESSAGE_UPDATE",
          message: { id: String(id), channel_id: String(channelId), content },
          __localEditRemastered: true
        });
      } catch (error) {
        log.error("[localedit] Could not refresh the displayed message.", error);
      }
    }

    function withEdit(message) {
      if (!message || message.id == null) return message;
      const edit = getEdit(message.id);
      if (!edit) return message;
      const channelId = message.channel_id ?? message.channelId;
      if (channelId != null && edit.channelId && String(channelId) !== String(edit.channelId)) return message;
      return { ...message, content: edit.content };
    }

    function processList(list) {
      return list.map(item => Array.isArray(item) ? processList(item) : withEdit(item));
    }

    function cancelNativeEditing() {
      if (nativeEditTimeout) clearTimeout(nativeEditTimeout);
      nativeEditTimeout = null;
      const actions = pendingNativeEdit?.actions;
      if (actions && originalNativeEditMessage && actions.editMessage === wrappedNativeEditMessage) {
        actions.editMessage = originalNativeEditMessage;
      }
      pendingNativeEdit = null;
      originalNativeEditMessage = null;
      wrappedNativeEditMessage = null;
    }

    function interceptor(action) {
      if (!enabled || !action?.type || action.__localEditRemastered) return false;
      if (pendingNativeEdit && ["CLEAR_EDITING_MESSAGE", "CANCEL_EDITING_MESSAGE", "END_EDITING_MESSAGE"].includes(action.type)) {
        const expectedEdit = pendingNativeEdit;
        setTimeout(() => { if (pendingNativeEdit === expectedEdit) cancelNativeEditing(); }, 50);
      }
      try {
        const message = action.message;
        if (message?.id != null &&
            (action.type === "MESSAGE_UPDATE" || action.type === "MESSAGE_CREATE")) {
          const edited = withEdit(message);
          if (edited !== message) action.message = edited;
        }
        if (Array.isArray(action.messages)) action.messages = processList(action.messages);
      } catch (error) {
        log.error("[localedit] Could not apply a saved local edit.", error);
      }
      return false;
    }

    function saveLocalEdit(message, content) {
      const id = String(message?.id ?? "");
      const channelId = String(message?.channel_id ?? message?.channelId ?? "");
      if (!id || !channelId) return false;
      const previous = getEdit(id);
      edits()[id] = {
        channelId,
        content,
        originalContent: previous ? previous.originalContent :
          (typeof message.content === "string" ? message.content : null)
      };
      dispatchContent(id, channelId, content);
      return true;
    }

    function clearLocalEdit(id) {
      id = String(id);
      const previous = getEdit(id);
      if (!previous) return;
      delete edits()[id];
      if (previous.originalContent !== null) {
        dispatchContent(id, previous.channelId, previous.originalContent);
        return;
      }
      try {
        if (MessageActions?.fetchMessages) {
          MessageActions.fetchMessages({ channelId: previous.channelId, limit: 50, jump: { messageId: id, flash: true } });
        } else if (MessageActions?.jumpToMessage) {
          MessageActions.jumpToMessage({ channelId: previous.channelId, messageId: id, flash: true });
        } else {
          log.warn("[localedit] Original text was unavailable for message", id, "- reload the channel to restore it.");
        }
      } catch (error) {
        log.error("[localedit] Could not reload the original message.", error);
      }
    }

    function applyToLoaded() {
      for (const [id, edit] of Object.entries(edits())) {
        try {
          if (MessageStore?.getMessage?.(edit.channelId, id)) dispatchContent(id, edit.channelId, edit.content);
        } catch (error) {
          log.warn("[localedit] Could not reapply saved edit to", id, error);
        }
      }
    }

    function openEditor(message) {
      const startActions = safeFind(findByProps, "startEditMessage");
      const editActions = safeFind(findByProps, "editMessage") || startActions;
      if (typeof startActions?.startEditMessage !== "function" || typeof editActions?.editMessage !== "function") {
        log.error("[localedit] Discord's native edit composer could not be found.");
        return;
      }

      cancelNativeEditing();
      const id = String(message?.id ?? "");
      const channel = String(message?.channel_id ?? message?.channelId ?? "");
      if (!id || !channel) return;
      pendingNativeEdit = { id, channel, message, actions: editActions };
      originalNativeEditMessage = editActions.editMessage;
      wrappedNativeEditMessage = function (...args) {
        const pending = pendingNativeEdit;
        const targetChannel = String(args?.[0] ?? "");
        const targetId = String(args?.[1] ?? "");
        if (!pending || targetId !== pending.id || (targetChannel && targetChannel !== pending.channel)) {
          return originalNativeEditMessage.apply(this, args);
        }
        const payload = args?.[2];
        const content = typeof payload === "string" ? payload : payload?.content ?? payload?.text ?? payload?.value;
        if (typeof content !== "string") return originalNativeEditMessage.apply(this, args);
        const targetMessage = pending.message;
        cancelNativeEditing();
        saveLocalEdit(targetMessage, content);
        try {
          FluxDispatcher.dispatch({ type: "CLEAR_EDITING_MESSAGE", channelId: channel, messageId: id });
        } catch {}
        return Promise.resolve();
      };
      editActions.editMessage = wrappedNativeEditMessage;
      nativeEditTimeout = setTimeout(cancelNativeEditing, 120000);

      try {
        startActions.startEditMessage(channel, id, String(getEdit(id)?.content ?? message.content ?? ""));
      } catch (error) {
        cancelNativeEditing();
        log.error("[localedit] Could not open Discord's native edit composer.", error);
      }
    }

    const isRow = element => !!element?.props &&
      typeof element.props.label === "string" &&
      typeof element.props.onPress === "function";

    function addMenuRow(tree, message) {
      const rows = findInReactTree(tree, node => Array.isArray(node) && node.some(isRow));
      if (!rows) { log.warn("[localedit] Found the message menu but not its action-row list."); return tree; }
      if (rows.some(row => row?.key === "local-edit-remastered-edit")) return tree;
      const currentUser = UserStore?.getCurrentUser?.();
      const authorId = message?.author?.id ?? message?.authorId;
      if (!storage.showOwnMessageAction && currentUser?.id != null && authorId != null && String(currentUser.id) === String(authorId)) return tree;

      const template = rows.find(row => isRow(row) && /edit/i.test(String(row?.props?.label ?? row?.props?.message ?? row?.props?.text ?? ""))) || rows.find(isRow);
      if (!template) return tree;
      const onPress = () => { try { ActionSheet?.hideActionSheet?.(); } catch {} openEditor(message); };
      let icon = template.props?.icon;
      try {
        const iconId = getAssetIDByName?.("ic_edit_24px");
        const RowIcon = safeFind(findByProps, "ActionSheetRow")?.ActionSheetRow?.Icon;
        if (RowIcon && iconId != null) icon = React.createElement(RowIcon, { source: iconId });
      } catch {}
      const row = React.cloneElement(template, {
        key: "local-edit-remastered-edit",
        label: "Edit Locally", message: "Edit Locally", text: "Edit Locally", title: "Edit Locally",
        icon, onPress, onPressRow: onPress, action: onPress
      });
      const index = pattern => rows.findIndex(item => pattern.test(String(item?.props?.label ?? item?.props?.message ?? item?.props?.text ?? item?.props?.title ?? "")));
      const reply = index(/\breply\b/i), forward = index(/\bforward\b/i), unread = index(/mark unread/i);
      const actionIndices = [reply, forward].filter(i => i >= 0);
      const at = actionIndices.length ? Math.min(...actionIndices) : unread >= 0 ? unread : rows.length;
      rows.splice(at, 0, row);
      return tree;
    }

    function patchActionSheet() {
      ActionSheet = safeFind(findByProps, "openLazy", "hideActionSheet");
      if (!ActionSheet || typeof ActionSheet.openLazy !== "function") {
        log.error("[localedit] Could not find Discord's lazy action-sheet module. Menu action was not installed.");
        return;
      }

      patches.push(before("openLazy", ActionSheet, ([component, key, props]) => {
        if (!enabled || typeof key !== "string" || !key.includes("MessageLongPress")) return;
        const message = props?.message ?? props?.props?.message;
        if (!message?.id) {
          log.warn("[localedit] Message menu opened without message props.");
          return;
        }

        Promise.resolve(component).then(instance => {
          if (!enabled || !instance) return;
          const target = typeof instance.default === "function" ? instance
            : typeof instance.default?.type === "function" ? instance.default
            : null;
          const prop = target === instance ? "default" : "type";
          if (!target) {
            log.error("[localedit] Message action sheet has an unsupported component shape.");
            return;
          }

          let unpatch;
          unpatch = after(prop, target, (_args, rendered) => {
            try {
              React.useEffect(() => () => {
                try { unpatch?.(); } catch {}
                const at = patches.indexOf(unpatch);
                if (at >= 0) patches.splice(at, 1);
              }, []);
              return addMenuRow(rendered, message);
            } catch (error) {
              log.error("[localedit] Could not add Edit Locally to the message menu.", error);
              return rendered;
            }
          });
          patches.push(unpatch);
        }).catch(error => log.error("[localedit] Could not load message action sheet.", error));
      }));
    }

    function Settings() {
      const [, refresh] = React.useState(0);
      const entries = Object.entries(edits());
      return React.createElement(ScrollView, { contentContainerStyle: { padding: 16 } },
        React.createElement(Text, { style: { fontSize: 22, fontWeight: "700", color: "#e5ddff", marginBottom: 8 } }, "Local Edit Remastered"),
        React.createElement(Text, { style: { color: "#c9c2dc", marginBottom: 16, lineHeight: 20 } },
          "These edits exist only on this device. They are never sent as Discord message edits."),
        React.createElement(Pressable, {
          onPress: () => { storage.showOwnMessageAction = !storage.showOwnMessageAction; refresh(n => n + 1); },
          style: { alignSelf: "flex-start", backgroundColor: "#55456f", borderRadius: 20, paddingVertical: 10, paddingHorizontal: 14, marginBottom: 12 }
        }, React.createElement(Text, { style: { color: "#fff", fontWeight: "600" } }, "Show Edit Locally on my own messages: " + (storage.showOwnMessageAction ? "ON" : "OFF"))),
        React.createElement(Pressable, {
          onPress: () => { storage.clearEditsOnRestart = !storage.clearEditsOnRestart; refresh(n => n + 1); },
          style: { alignSelf: "flex-start", backgroundColor: "#302a40", borderWidth: 1, borderColor: "#51465f", borderRadius: 20, paddingVertical: 10, paddingHorizontal: 14, marginBottom: 10 }
        }, React.createElement(Text, { style: { color: "#f5efff", fontWeight: "600" } }, "Clear local edits on app restart: " + (storage.clearEditsOnRestart ? "ON" : "OFF"))),
        React.createElement(Text, { style: { color: "#c9bfd9", fontSize: 12, marginBottom: 16 } }, "Off by default, so edits persist across restarts. Turn it on to keep them only for the current app session."),
        React.createElement(Text, { style: { color: "#e5ddff", fontWeight: "600", marginBottom: 12 } }, "Saved local edits: " + entries.length),
        ...entries.map(([id, edit]) => React.createElement(View, {
          key: id, style: { backgroundColor: "#302b42", borderRadius: 14, padding: 14, marginBottom: 10 }
        },
          React.createElement(Text, { style: { color: "#bca7ff", fontSize: 12, marginBottom: 6 } }, "Message ID: " + id),
          React.createElement(Text, { style: { color: "#f2effa", marginBottom: 12 }, numberOfLines: 3 }, edit.content || "(empty message)"),
          React.createElement(Pressable, {
            onPress: () => { clearLocalEdit(id); refresh(n => n + 1); },
            style: { alignSelf: "flex-start", backgroundColor: "#55456f", borderRadius: 20, paddingVertical: 8, paddingHorizontal: 14 }
          }, React.createElement(Text, { style: { color: "#ffffff", fontWeight: "600" } }, "Clear local edit"))
        )),
        entries.length === 0
          ? React.createElement(Text, { style: { color: "#aaa2bf", fontStyle: "italic" } },
            "No local edits yet. Long-press someone else's message and choose Edit Locally.")
          : null
      );
    }

    function unload() {
      if (!enabled) return;
      enabled = false;
      cancelNativeEditing();
      try {
        if (Array.isArray(FluxDispatcher?._interceptors)) {
          FluxDispatcher._interceptors = FluxDispatcher._interceptors.filter(item => item !== interceptor);
        }
      } catch {}
      for (const unpatch of patches.splice(0)) {
        try { unpatch(); } catch {}
      }
      try {
        for (const [id, edit] of Object.entries(edits())) {
          if (edit.originalContent !== null && MessageStore?.getMessage?.(edit.channelId, id)) {
            dispatchContent(id, edit.channelId, edit.originalContent);
          }
        }
      } catch {}
      log.log("[localedit] Unloaded.");
    }

    function load() {
      try {
        const kiraController = globalThis.__kiraUtilsLive || globalThis.__kiraUtilsController;
        kiraController?.setFeature?.("localEdit", false);
      } catch {}
      const registry = globalThis.__lesbunnyLocalEditPlugins || (globalThis.__lesbunnyLocalEditPlugins = {});
      registry.remastered?.();
      const stop = () => {
        if (registry.remastered === stop) delete registry.remastered;
        unload();
      };
      registry.remastered = stop;

      enabled = true;
      MessageStore = safeFind(findByStoreName, "MessageStore") ||
        safeFind(findByProps, "getMessage", "getMessages");
      UserStore = safeFind(findByStoreName, "UserStore") ||
        safeFind(findByProps, "getCurrentUser");
      MessageActions = safeFind(findByProps, "fetchMessages", "sendMessage") ||
        safeFind(findByProps, "jumpToMessage");
      try { (FluxDispatcher._interceptors ??= []).unshift(interceptor); }
      catch (error) { log.error("[localedit] Could not register message-update interceptor.", error); }
      patchActionSheet();
      applyToLoaded();
      log.log("[localedit] Loaded v1.3.0. Edit Locally appears above Reply/Forward where available.");
    }

    return { onLoad: load, onUnload: unload, settings: Settings };
  })()
})