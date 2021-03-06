import C = kBgCmd
import {
  browserTabs, browserWindows, InfoToCreateMultiTab, openMultiTab, Tab, tabsGet, getTabUrl, selectFrom, runtimeError_,
  selectTab, getCurWnd, getCurTabs, getCurTab, getCurShownTabs_ff_only, browserSessions, browser_
} from "./browser"
import {
  cPort, cRepeat, cKey, get_cOptions, set_cPort, set_cOptions, set_cRepeat, set_cKey, cNeedConfirm, set_executeCommand,
  executeCommand, contentPayload, settings
} from "./store"
import {
  framesForTab, portSendFgCmd, indexFrame, requireURL, framesForOmni, sendFgCmd, complainNoSession, showHUD,
  complainLimits,
  getPortUrl,
} from "./ports"
import { maySedRuleExist, parseSedOptions_, substitute_ } from "./clipboard"
import { goToNextUrl, newTabIndex, openUrl } from "./open_urls"
import {
  parentFrame, enterVisualMode, showVomnibar, toggleZoom, confirm_, gOnConfirmCallback, captureTab,
  set_gOnConfirmCallback, initHelp, setOmniStyle, framesGoBack, mainFrame, nextFrame, performFind, framesGoNext
} from "./frame_commands"
import {
  copyWindowInfo, getTabRange, joinTabs, moveTabToNewWindow, moveTabToNextWindow, reloadTab, removeTab, toggleMuteTab,
  togglePinTab, toggleTabUrl
} from "./tab_commands"

declare const enum Info { NoTab = 0, ActiveTab = 1, CurWndTabsIfRepeat = 2, CurWndTabs = 3, CurShownTabs = 4 }
type BgCmdNoTab = (this: void, _fakeArg?: undefined) => void
type BgCmdActiveTab = (this: void, tabs1: [Tab]) => void
type BgCmdActiveTabOrNoTab = (this: void, tabs1?: [Tab]) => void
type BgCmdCurWndTabs = (this: void, tabs1: Tab[]) => void

interface BgCmdInfoNS {
  [kBgCmd.captureTab]: Info.ActiveTab
  [kBgCmd.createTab]: Info.ActiveTab
  [kBgCmd.discardTab]: Info.CurWndTabs
  [kBgCmd.goBackFallback]: Info.ActiveTab
  [kBgCmd.goToTab]: Info.CurShownTabs | Info.CurWndTabs
  [kBgCmd.moveTab]: Info.CurWndTabs
  [kBgCmd.moveTabToNextWindow]: Info.ActiveTab
  [kBgCmd.openUrl]: Info.ActiveTab | Info.NoTab
  [kBgCmd.reloadTab]: Info.CurWndTabsIfRepeat
  [kBgCmd.removeRightTab]: Info.CurWndTabs
  [kBgCmd.removeTabsR]: Info.CurWndTabs
  [kBgCmd.reopenTab]: Info.ActiveTab
  [kBgCmd.searchInAnother]: Info.ActiveTab
  [kBgCmd.toggleCS]: Info.ActiveTab
  [kBgCmd.togglePinTab]: Info.CurWndTabsIfRepeat
  [kBgCmd.toggleTabUrl]: Info.ActiveTab
  [kBgCmd.toggleVomnibarStyle]: Info.ActiveTab
  [kBgCmd.visitPreviousTab]: Info.CurShownTabs | Info.CurWndTabs
}

const abs = Math.abs

const BgCmdInfo: { readonly [K in keyof BgCmdOptions]: K extends keyof BgCmdInfoNS ? BgCmdInfoNS[K] : Info.NoTab } = [
  /* kBgCmd.blank           */ Info.NoTab, Info.NoTab, Info.NoTab, Info.NoTab, Info.NoTab,
  /* kBgCmd.performFind     */ Info.NoTab, Info.NoTab, Info.NoTab, Info.NoTab, Info.NoTab,
  /* kBgCmd.addBookmark     */ Info.NoTab, Info.NoTab, Info.ActiveTab, Info.NoTab, Info.NoTab,
  /* kBgCmd.clearMarks      */ Info.NoTab, Info.NoTab, Info.ActiveTab, Info.CurWndTabs, Info.NoTab,
  /* kBgCmd.goBackFallback  */ Info.ActiveTab,
      Build.BTypes & BrowserType.Firefox && (!(Build.BTypes & ~BrowserType.Firefox) || OnOther === BrowserType.Firefox)
      ? Info.CurShownTabs : Info.CurWndTabs, Info.NoTab, Info.NoTab, Info.NoTab,
  /* kBgCmd.moveTab         */ Info.CurWndTabs, Info.NoTab, Info.ActiveTab, Info.NoTab, Info.CurWndTabsIfRepeat,
  /* kBgCmd.removeRightTab  */ Info.CurWndTabs, Info.NoTab, Info.CurWndTabs, Info.ActiveTab, Info.NoTab,
  /* kBgCmd.restoreTab      */ Info.NoTab, Info.NoTab, Info.ActiveTab, Info.NoTab, Info.NoTab, Info.ActiveTab,
  /* kBgCmd.togglePinTab    */ Info.NoTab, Info.CurWndTabsIfRepeat, Info.ActiveTab, Info.ActiveTab, Info.NoTab,
      Build.BTypes & BrowserType.Firefox && (!(Build.BTypes & ~BrowserType.Firefox) || OnOther === BrowserType.Firefox)
      ? Info.CurShownTabs : Info.CurWndTabs
]

const BackgroundCommands: {
  readonly [K in keyof BgCmdOptions]: K extends keyof BgCmdInfoNS
      ? BgCmdInfoNS[K] extends Info.ActiveTab ? BgCmdActiveTab
        : BgCmdInfoNS[K] extends Info.CurWndTabsIfRepeat | Info.CurWndTabs | Info.CurShownTabs ? BgCmdCurWndTabs
        : BgCmdInfoNS[K] extends Info.ActiveTab | Info.NoTab ? BgCmdActiveTabOrNoTab
        : never
      : BgCmdNoTab
} = [
  /* kBgCmd.blank: */ BgUtils_.blank_,

  // region: need cport
  /* kBgCmd.goNext: */ (): void => {
    const rawRel = get_cOptions<C.goNext>().rel
    const rel = rawRel ? rawRel + "" : "next"
    const isNext = get_cOptions<C.goNext>().isNext != null ? !!get_cOptions<C.goNext>().isNext
        : !rel.includes("prev") && !rel.includes("before")
    const sed = parseSedOptions_(get_cOptions<C.goNext, true>())
    if (!sed || sed.r === false || !sed.k && !maySedRuleExist(SedContext.goNext)) {
      framesGoNext(isNext, rel)
      return
    }
    Promise.resolve(getPortUrl(indexFrame(cPort.s.t, 0))).then((tabUrl): void => {
      const count = isNext ? cRepeat : -cRepeat
      const template = tabUrl && substitute_(tabUrl, SedContext.goNext, sed)
      const [hasPlaceholder, next] = template ? goToNextUrl(template, count
          , get_cOptions<C.goNext>().absolute ? "absolute" : true) : [false, tabUrl]
      if (hasPlaceholder && next) {
        set_cRepeat(count)
        set_cOptions(BgUtils_.extendIf_(BgUtils_.safer_<UnknownOptions<kBgCmd.openUrl>>({
            url_f: next, goNext: false, sed: false }), get_cOptions<kBgCmd.openUrl>()))
        if (get_cOptions<C.openUrl>().reuse === void 0) {
          get_cOptions<C.openUrl, true>().reuse = ReuseType.current
        }
        openUrl()
      } else {
        framesGoNext(isNext, rel)
      }
    })
  },
  /* kBgCmd.insertMode: */ (): void => {
    let _key = get_cOptions<C.insertMode>().key, _hud: boolean | UnknownValue,
    hud = (_hud = get_cOptions<C.insertMode>().hideHUD) != null ? !_hud
        : (_hud = get_cOptions<C.insertMode>().hideHud) != null ? !_hud
        : !settings.cache_.hideHud,
    key = _key && typeof _key === "string" && _key.length > 3 ? BgUtils_.stripKey_(_key) : ""
    sendFgCmd(kFgCmd.insertMode, hud, {
      h: hud ? trans_("" + kTip.globalInsertMode, [key && ": " + _key]) : null,
      k: key || null,
      i: !!get_cOptions<C.insertMode>().insert,
      p: !!get_cOptions<C.insertMode>().passExitKey,
      r: <BOOL> +!!get_cOptions<C.insertMode>().reset,
      u: !!get_cOptions<C.insertMode>().unhover
    })
  },
  /* kBgCmd.nextFrame: */ nextFrame,
  /* kBgCmd.parentFrame: */ parentFrame,
  /* kBgCmd.performFind: */ performFind,
  /* kBgCmd.toggle: */ (): void => {
    type Keys = SettingsNS.FrontendSettingsSyncingItems[keyof SettingsNS.FrontendSettingsSyncingItems][0]
    type ManualNamesMap = SelectNameToKey<SettingsNS.ManuallySyncedItems>
    const key: Keys = (get_cOptions<C.toggle>().key || "") + "" as Keys,
    key2 = key === "darkMode" ? "d" as ManualNamesMap["darkMode"]
        : key === "reduceMotion" ? "m" as ManualNamesMap["reduceMotion"]
        : settings.valuesToLoad_[key],
    old = key2 ? contentPayload[key2] : 0, keyRepr = trans_("quoteA", [key])
    let value = get_cOptions<C.toggle>().value, isBool = typeof value === "boolean", msg = ""
    if (!key2) {
      msg = trans_(key in settings.defaults_ ? "notFgOpt" : "unknownA", [keyRepr])
    } else if (typeof old === "boolean") {
      isBool || (value = null)
    } else if (isBool || value === undefined) {
      msg = trans_(isBool ? "notBool" : "needVal", [keyRepr])
    } else if (typeof value !== typeof old) {
      msg = JSON.stringify(old)
      msg = trans_("unlikeVal", [keyRepr, msg.length > 10 ? msg.slice(0, 9) + "\u2026" : msg])
    }
    if (msg) {
      showHUD(msg)
    } else {
      value = settings.updatePayload_(key2, value)
      const ports = framesForTab[cPort.s.t]!
      for (let i = 1; i < ports.length; i++) {
        let isCur = ports[i] === ports[0]
        portSendFgCmd(ports[i], kFgCmd.toggle, isCur, { k: key2, n: isCur ? keyRepr : "", v: value }, 1)
      }
    }
  },
  /* kBgCmd.showHelp: */ (): void => {
    if (cPort.s.i === 0 && !(cPort.s.f & Frames.Flags.hadHelpDialog)) {
      initHelp({ a: get_cOptions<C.showHelp, true>() }, cPort)
    } else {
      window.HelpDialog || BgUtils_.require_("HelpDialog")
      sendFgCmd(kFgCmd.showHelpDialog, true, get_cOptions<C.showHelp, true>())
    }
  },
  /* kBgCmd.showVomnibar: */ showVomnibar,
  /* kBgCmd.visualMode: */ enterVisualMode,
  // endregion: need cport

  /* kBgCmd.addBookmark: */ (): void => {
    const path: string | UnknownValue = get_cOptions<C.addBookmark>().folder || get_cOptions<C.addBookmark>().path
    const nodes = path ? (path + "").replace(<RegExpG> /\\/g, "/").split("/").filter(i => i) : []
    if (!nodes.length) { showHUD('Need "path" to a bookmark folder.'); return }
    browser_.bookmarks.getTree((tree): void => {
      if (!tree) { return runtimeError_() }
      let roots = tree[0].children!
      let doesMatchRoot = roots.filter(i => i.title === nodes[0])
      if (doesMatchRoot.length) {
        roots = doesMatchRoot
      } else {
        roots = roots.reduce((i, j) => i.concat(j.children!), [] as chrome.bookmarks.BookmarkTreeNode[])
      }
      let folder: chrome.bookmarks.BookmarkTreeNode | null = null
      for (let node of nodes) {
        roots = roots.filter(i => i.title === node)
        if (!roots.length) {
          return showHUD("The bookmark folder is not found.")
        }
        folder = roots[0]
        roots = folder.children!
        if (!roots) { break }
      }
      (cRepeat * cRepeat < 2 ? getCurTab : Build.BTypes & BrowserType.Firefox
          && (!(Build.BTypes & ~BrowserType.Firefox) || OnOther === BrowserType.Firefox)
          ? getCurShownTabs_ff_only! : getCurTabs)(function doAddBookmarks(tabs?: Tab[]): void {
        if (!tabs || !tabs.length) { runtimeError_(); return }
        const ind = (Build.BTypes & BrowserType.Firefox ? selectFrom(tabs, 1) : selectFrom(tabs)).index
        let [start, end] = getTabRange(ind, tabs.length)
        let count = end - start
        if (count > 20) {
          if (Build.BTypes & ~BrowserType.Chrome) {
            if (cNeedConfirm) {
              confirm_(kCName.addBookmark, count, doAddBookmarks.bind(0, tabs))
              return
            }
          } else {
            if (!(count = confirm_(kCName.addBookmark, count)!)) { return }
            if (count === 1) { start = ind, end = ind + 1 }
          }
        }
        for (const tab of tabs.slice(start, end)) {
          browser_.bookmarks.create({ parentId: folder!.id, title: tab.title, url: getTabUrl(tab) }, runtimeError_)
        }
        showHUD(`Add ${end - start} bookmark${end > start + 1 ? "s" : ""}.`)
      })
    })
  },
  /* kBgCmd.autoOpenFallback: */ (): void => {
    set_cOptions(BgUtils_.safer_<KnownOptions<C.openUrl>>({
      copied: true,
      keyword: get_cOptions<C.autoOpenFallback, true>().keyword
    }))
    openUrl()
  },
  /* kBgCmd.captureTab: */ captureTab,
  /* kBgCmd.clearCS: */ (): void => {
    Build.PContentSettings ? ContentSettings_.clearCS_(get_cOptions<C.clearCS, true>(), cPort)
    : (ContentSettings_.complain_ as () => any)()
  },
  /* kBgCmd.clearFindHistory: */ (): void => {
    const incognito = cPort ? cPort.s.a : TabRecency_.incognito_ === IncognitoType.true
    FindModeHistory_.removeAll_(incognito)
    return showHUD(trans_("fhCleared", [incognito ? trans_("incog") : ""]))
  },
  /* kBgCmd.clearMarks: */ (): void => {
    get_cOptions<C.clearMarks>().local ? get_cOptions<C.clearMarks>().all ? Marks_.clear_("#")
    : requireURL({ H: kFgReq.marks, u: "" as "url", a: kMarkAction.clear }, true) : Marks_.clear_()
  },
  /* kBgCmd.copyWindowInfo: */ copyWindowInfo,
  /* kBgCmd.createTab: */ function createTab(tabs?: [Tab] | Tab): void {
    if (get_cOptions<C.createTab>().url || get_cOptions<C.createTab>().urls) {
      openUrl(tabs as [Tab] | undefined)
      return runtimeError_()
    }
    let tab: Tab | null = null
    if (tabs && !(tabs instanceof Array)) { tab = tabs; TabRecency_.curTab_ = tab.id }
    else if (tabs && tabs.length > 0) { tab = tabs[0] }
    if (!tab && TabRecency_.curTab_ >= 0) {
      TabRecency_.curTab_ = GlobalConsts.TabIdNone
      tabsGet(TabRecency_.curTab_, createTab)
    } else {
      openMultiTab((tab ? {
        active: tab.active, windowId: tab.windowId,
        openerTabId: get_cOptions<C.createTab>().opener ? tab.id : void 0,
        index: newTabIndex(tab, get_cOptions<C.createTab>().position)
      } : {active: true}) as InfoToCreateMultiTab, cRepeat, get_cOptions<C.createTab, true>().evenIncognito)
    }
    return runtimeError_()
  },
  /* kBgCmd.discardTab: */ (tabs: Tab[]): void => {
    if (Build.BTypes & BrowserType.Chrome && Build.MinCVer < BrowserVer.Min$tabs$$discard
        && CurCVer_ < BrowserVer.Min$tabs$$discard) {
      showHUD(trans_("noDiscardIfOld", [BrowserVer.Min$tabs$$discard]))
    }
    let current = (Build.BTypes & BrowserType.Firefox ? selectFrom(tabs, 1) : selectFrom(tabs)).index
      , end = Math.max(0, Math.min(current + cRepeat, tabs.length - 1)),
    count = abs(end - current), step = end > current ? 1 : -1
    if (count > 20) {
      if (Build.BTypes & ~BrowserType.Chrome) {
        if (cNeedConfirm) {
          confirm_(kCName.discardTab, count, BackgroundCommands[kBgCmd.discardTab].bind(null, tabs))
          return
        }
      } else {
        count = confirm_(kCName.discardTab, count)!
      }
    }
    if (!count) { return }
    const near = tabs[current + step]
    if (!near.discarded && (count < 2 || near.autoDiscardable)) {
      browserTabs.discard(near.id, count > 1 ? runtimeError_ : (): void => {
        const err = runtimeError_()
        err && showHUD(trans_("discardFail"))
        return err
      })
    }
    for (let i = 2; i <= count; i++) {
      const tab = tabs[current + step * i]
      if (!tab.discarded && tab.autoDiscardable) {
        browserTabs.discard(tab.id, runtimeError_)
      }
    }
  },
  /* kBgCmd.duplicateTab: */ (): void => {
    const tabId = cPort ? cPort.s.t : TabRecency_.curTab_
    if (tabId < 0) {
      return complainLimits(trans_("dupTab"))
    }
    browserTabs.duplicate(tabId)
    if (cRepeat < 2) { return }
    const fallback = (tab: Tab): void => {
      openMultiTab({
        url: getTabUrl(tab), active: false, windowId: tab.windowId,
        pinned: tab.pinned,
        index: tab.index + 2 , openerTabId: tab.id
      }, cRepeat - 1)
    }
    if (Build.MinCVer >= BrowserVer.MinNoAbnormalIncognito || !(Build.BTypes & BrowserType.Chrome)
        || CurCVer_ >= BrowserVer.MinNoAbnormalIncognito
        || TabRecency_.incognito_ === IncognitoType.ensuredFalse
        || settings.CONST_.DisallowIncognito_
        ) {
      tabsGet(tabId, fallback)
    } else {
      getCurWnd(true, (wnd): void => {
        const tab = wnd && wnd.tabs.filter(tab2 => tab2.id === tabId)[0]
        if (!tab || !wnd!.incognito || tab.incognito) {
          return tab ? fallback(tab) : runtimeError_()
        }
        for (let count = cRepeat; 0 < --count; ) {
          browserTabs.duplicate(tabId)
        }
      })
    }
  },
  // only work on Chrome: Firefox has neither tabs.goBack, nor support for tabs.update("javascript:...")
  /* kBgCmd.goBackFallback: */ Build.BTypes & BrowserType.Chrome ? (tabs: [Tab]): void => {
    if (!tabs.length) { return }
    framesGoBack({ s: cRepeat, r: get_cOptions<C.goBackFallback, true>().reuse }, null, tabs[0])
  } : BgUtils_.blank_,
  /* kBgCmd.goToTab: */ (tabs: Tab[]): void => {
    if (tabs.length < 2) { return }
    const count = cRepeat, len = tabs.length
    let cur: Tab | undefined, index = get_cOptions<C.goToTab>().absolute
      ? count > 0 ? Math.min(len, count) - 1 : Math.max(0, len + count)
      : abs(count) > tabs.length * 2 ? (count > 0 ? -1 : 0)
      : (cur = Build.BTypes & BrowserType.Firefox ? selectFrom(tabs, 1) : selectFrom(tabs)).index + count
    index = index >= 0 ? index % len : len + (index % len || -len)
    let toSelect: Tab = tabs[index]
    if (toSelect.pinned && count < 0 && get_cOptions<C.goToTab>().noPinned) {
      let curIndex = (cur || (Build.BTypes & BrowserType.Firefox ? selectFrom(tabs, 1) : selectFrom(tabs))).index
      if (curIndex > index && !tabs[curIndex - 1].pinned) {
        while (tabs[index].pinned) { index++ }
        toSelect = tabs[index]
      }
    }
    if (!toSelect.active) { selectTab(toSelect.id) }
  },
  /* kBgCmd.goUp: */ (): void => {
    if (get_cOptions<C.goUp>().type !== "frame" && cPort && cPort.s.i) {
      set_cPort(indexFrame(cPort.s.t, 0) || cPort)
    }
    requireURL({ H: kFgReq.parseUpperUrl, u: "" as "url",
      p: cRepeat,
      t: get_cOptions<C.goUp, true>().trailingSlash, r: get_cOptions<C.goUp, true>().trailing_slash,
      s: parseSedOptions_(get_cOptions<C.goUp, true>()),
      e: true
    })
  },
  /* kBgCmd.joinTabs: */ joinTabs,
  /* kBgCmd.mainFrame: */ mainFrame,
  /* kBgCmd.moveTab: */ (tabs: Tab[]): void => {
    const tab = selectFrom(tabs), pinned = tab.pinned
    let index = Math.max(0, Math.min(tabs.length - 1, tab.index + cRepeat))
    while (pinned !== tabs[index].pinned) { index -= cRepeat > 0 ? 1 : -1 }
    if (index !== tab.index) {
      browserTabs.move(tab.id, { index })
    }
  },
  /* kBgCmd.moveTabToNewWindow: */ moveTabToNewWindow,
  /* kBgCmd.moveTabToNextWindow: */ moveTabToNextWindow,
  /* kBgCmd.openUrl: */ openUrl,
  /* kBgCmd.reloadTab: */ reloadTab,
  /* kBgCmd.removeRightTab: */ (tabs: Tab[]): void => {
    if (!tabs) { return }
    const ind = selectFrom(tabs).index, [start, end] = getTabRange(ind, tabs.length, 0, 1)
    browserTabs.remove(tabs[ind + 1 === end || cRepeat > 0 && start !== ind ? start : end - 1].id)
  },
  /* kBgCmd.removeTab: */ removeTab,
  /* kBgCmd.removeTabsR: */ (tabs: Tab[]): void => {
    /** `direction` is treated as limited; limited by pinned */
    let activeTab = selectFrom(tabs), direction = get_cOptions<C.removeTabsR>().other ? 0 : cRepeat
    let i = activeTab.index, noPinned = false
    const filter = get_cOptions<C.removeTabsR, true>().filter
    if (direction > 0) {
      ++i
      tabs = tabs.slice(i, i + direction)
    } else {
      noPinned = i > 0 && tabs[0].pinned && !tabs[i - 1].pinned
      if (direction < 0) {
        tabs = tabs.slice(Math.max(i + direction, 0), i)
      } else {
        tabs.splice(i, 1)
      }
    }
    if (noPinned) {
      tabs = tabs.filter(tab => !tab.pinned)
    }
    if (filter) {
      const title = filter.includes("title") ? activeTab.title : "",
      full = filter.includes("hash"), activeTabUrl = getTabUrl(activeTab),
      onlyHost = filter.includes("host") ? BgUtils_.safeParseURL_(activeTabUrl) : null,
      urlToFilter = full ? activeTabUrl : onlyHost ? onlyHost.host : activeTabUrl.split("#", 1)[0]
      tabs = tabs.filter(tab => {
        const tabUrl = getTabUrl(tab), parsed = onlyHost ? BgUtils_.safeParseURL_(activeTabUrl) : null
        const url = parsed ? parsed.host : full ? tabUrl : tabUrl.split("#", 1)[0]
        return url === urlToFilter && (!title || tab.title === title)
      })
    }
    if (tabs.length > 0) {
      browserTabs.remove(tabs.map(tab => tab.id), runtimeError_)
    }
  },
  /* kBgCmd.reopenTab: */ (tabs: [Tab] | never[]): void => {
    if (tabs.length <= 0) { return }
    const tab = tabs[0]
    ++tab.index
    if (Build.MinCVer >= BrowserVer.MinNoAbnormalIncognito || !(Build.BTypes & BrowserType.Chrome)
        || CurCVer_ >= BrowserVer.MinNoAbnormalIncognito
        || TabRecency_.incognito_ === IncognitoType.ensuredFalse || settings.CONST_.DisallowIncognito_
        || !BgUtils_.isRefusingIncognito_(getTabUrl(tab))) {
      Backend_.reopenTab_(tab)
    } else {
      browserWindows.get(tab.windowId, (wnd): void => {
        if (wnd.incognito && !tab.incognito) {
          tab.openerTabId = tab.windowId = undefined as never
        }
        Backend_.reopenTab_(tab)
      })
    }
  },
  /* kBgCmd.restoreGivenTab: */ (): void => {
    const sessions = browserSessions()
    if ((Build.BTypes & BrowserType.Edge || Build.BTypes & BrowserType.Firefox && Build.MayAndroidOnFirefox
          || Build.BTypes & BrowserType.Chrome && Build.MinCVer < BrowserVer.MinSessions) && !sessions) {
      return complainNoSession()
    }
    const doRestore = (list: chrome.sessions.Session[]): void => {
      if (cRepeat > list.length) {
        return showHUD(trans_("indexOOR"))
      }
      const session = list[cRepeat - 1], item = session.tab || session.window
      item && sessions.restore(item.sessionId)
    }
    if (cRepeat > sessions.MAX_SESSION_RESULTS) {
      return doRestore([])
    }
    if (cRepeat <= 1) {
      sessions.restore(null, runtimeError_)
      return
    }
    sessions.getRecentlyClosed(doRestore)
  },
  /* kBgCmd.restoreTab: */ (): void => {
    const sessions = browserSessions()
    if ((Build.BTypes & BrowserType.Edge || Build.BTypes & BrowserType.Firefox && Build.MayAndroidOnFirefox
          || Build.BTypes & BrowserType.Chrome && Build.MinCVer < BrowserVer.MinSessions) && !sessions) {
      return complainNoSession()
    }
    let count = cRepeat
    if (abs(count) < 2 && (cPort ? cPort.s.a : TabRecency_.incognito_ === IncognitoType.true)) {
      return showHUD(trans_("notRestoreIfIncog"))
    }
    const limit = sessions.MAX_SESSION_RESULTS
    count > limit && (count = limit)
    do {
      sessions.restore(null, runtimeError_)
    } while (0 < --count)
  },
  /* kBgCmd.runKey: */ (): void => {
    let keys = get_cOptions<C.runKey>().keys, absCRepeat = abs(cRepeat), key: string | undefined
    if (typeof keys === "string" && keys.trim() && keys.includes(" ")) {
      keys = keys.split(" ")
    }
    if (!(keys instanceof Array)) {
      showHUD('Require keys: space-seperated-string | string[]')
    } else if (absCRepeat > keys.length && keys.length !== 1) {
      showHUD('"runKey" has no such a key')
    } else if (key = keys[keys.length === 1 ? 0 : absCRepeat - 1], typeof key !== "string") {
      showHUD('in "runKey", the key is invalid')
    } else if (cPort) {
      (cPort as Frames.Port).s.f |= Frames.Flags.userActed
      let count = 1, arr: null | string[] = (<RegExpOne> /^\d+|^-\d*/).exec(key)
      if (arr != null) {
        let prefix = arr[0]
        key = key.slice(prefix.length)
        count = prefix !== "-" ? parseInt(prefix, 10) || 1 : -1
      }
      let registryEntry = CommandsData_.keyToCommandRegistry_.get(key)
      if (!registryEntry) {
        showHUD('in "runKey", the key is invalid')
      } else if (registryEntry.alias_ === kBgCmd.runKey && registryEntry.background_) {
        showHUD('"runKey" can not be nested')
      } else {
        BgUtils_.resetRe_()
        count = keys.length === 1 ? count * cRepeat : absCRepeat !== cRepeat ? -count : count
        if (Object.keys(get_cOptions<C.runKey>()).length > 1) {
          registryEntry = BgUtils_.extendIf_(BgUtils_.safeObj_<{}>(), registryEntry)
          let newOptions = BgUtils_.safeObj_<{}>()
          BgUtils_.extendIf_(newOptions, get_cOptions<C.runKey>())
          delete newOptions.keys
          registryEntry.options_ && BgUtils_.extendIf_(newOptions, registryEntry.options_);
          (registryEntry as Writable<typeof registryEntry>).options_ = newOptions
        }
        executeCommand(registryEntry, count, cKey, cPort, 0)
      }
    }
  },
  /* kBgCmd.searchInAnother: */ (tabs: [Tab]): void => {
    let keyword = (get_cOptions<C.searchInAnother>().keyword || "") + ""
    const query = Backend_.parse_({ u: getTabUrl(tabs[0]) })
    if (!query || !keyword) {
      showHUD(trans_(keyword ? "noQueryFound" : "noKw"))
      return
    }
    let url_f = BgUtils_.createSearchUrl_(query.u.split(" "), keyword, Urls.WorkType.ActAnyway)
    let reuse = get_cOptions<C.searchInAnother>().reuse
    set_cOptions(BgUtils_.safer_({ reuse: reuse ?? ReuseType.current, opener: true, url_f }))
    openUrl(tabs)
  },
  /* kBgCmd.showTip: */ (): void => {
    let text = get_cOptions<C.showTip>().text
    showHUD(text ? text + "" : trans_("needText"))
  },
  /* kBgCmd.sendToExtension: */ (): void => {
    let targetID = get_cOptions<C.sendToExtension>().id, data = get_cOptions<C.sendToExtension>().data
    if (targetID && typeof targetID === "string" && data !== void 0) {
      const now = Date.now()
      chrome.runtime.sendMessage(targetID, get_cOptions<C.sendToExtension>().raw ? data : {
        handler: "message", from: "Vimium C", count: cRepeat, keyCode: cKey, data
      }, (cb): void => {
        if (runtimeError_()) {
          let err: any = runtimeError_()
          console.log(`Can not send message to the extension %o:`, targetID, err)
          showHUD("Error: " + (err.message || err))
        } else if (typeof cb === "string" && Math.abs(Date.now() - now) < 1e3) {
          showHUD(cb)
        }
      })
    } else {
      showHUD('Require a string "id" and message "data"')
    }
  },
  /* kBgCmd.toggleCS: */ (tabs: [Tab]): void => {
    Build.PContentSettings ? ContentSettings_.toggleCS_(cRepeat, get_cOptions<C.toggleCS, true>(), tabs)
        : (ContentSettings_.complain_ as () => any)()
  },
  /* kBgCmd.toggleMuteTab: */ toggleMuteTab,
  /* kBgCmd.togglePinTab: */ togglePinTab,
  /* kBgCmd.toggleTabUrl: */ toggleTabUrl,
  /* kBgCmd.toggleVomnibarStyle: */ (tabs: [Tab]): void => {
    const tabId = tabs[0].id, toggled = ((get_cOptions<C.toggleVomnibarStyle>().style || "") + "").trim(),
    current = !!get_cOptions<C.toggleVomnibarStyle>().current
    if (!toggled) {
      showHUD(trans_("noStyleName"))
      return
    }
    for (const frame of framesForOmni) {
      if (frame.s.t === tabId) {
        frame.postMessage({ N: kBgReq.omni_toggleStyle, t: toggled, c: current })
        return
      }
    }
    current || setOmniStyle({ t: toggled, o: 1 })
  },
  /* kBgCmd.toggleZoom: */ toggleZoom,
  /* kBgCmd.visitPreviousTab: */ (tabs: Tab[]): void => {
    if (tabs.length < 2) { return }
    tabs.splice((Build.BTypes & BrowserType.Firefox ? selectFrom(tabs, 1) : selectFrom(tabs)).index, 1)
    tabs = tabs.filter(i => TabRecency_.tabs_.has(i.id)).sort(TabRecency_.rCompare_)
    const tab = tabs[cRepeat > 0 ? Math.min(cRepeat, tabs.length) - 1
      : Math.max(0, tabs.length + cRepeat)]
    tab && selectTab(tab.id)
  }
]

const executeCmdOnTabs = (tabs: Tab[] | [Tab] | undefined): void => {
  const callback = gOnConfirmCallback
  set_gOnConfirmCallback(null)
  callback && (callback as unknown as BgCmdCurWndTabs)(tabs!)
  return tabs ? void 0 : runtimeError_()
}

/** this functions needs to accept any types of arguments and normalize them */
export const executeExternalCmd = (message: Partial<ExternalMsgs[kFgReq.command]["req"]>
    , sender: chrome.runtime.MessageSender): void => {
  BgUtils_.GC_()
  KeyMappings ? KeyMappings.execute_(message, sender, executeCommand)
      : BgUtils_.require_("KeyMappings").then(() => executeExternalCmd(message, sender))
}

const onLargeCountConfirmed = (registryEntry: CommandsNS.Item): void => {
  executeCommand(registryEntry, 1, cKey, cPort, cRepeat)
}

set_executeCommand((registryEntry: CommandsNS.Item, count: number, lastKey: kKeyCode, port: Port
    , overriddenCount: number): void => {
  if (gOnConfirmCallback) {
    set_gOnConfirmCallback(null) // just in case that some callbacks were thrown away
    return
  }
  const { options_: options, repeat_: repeat } = registryEntry
  let scale: number | undefined
  // .count may be invalid, if from other extensions
  if (options && (scale = options.count)) { count = count * scale || 1 }
  count = Build.BTypes & ~BrowserType.Chrome && overriddenCount
    || (count >= GlobalConsts.CommandCountLimit + 1 ? GlobalConsts.CommandCountLimit
        : count <= -GlobalConsts.CommandCountLimit - 1 ? -GlobalConsts.CommandCountLimit
        : (count | 0) || 1)
  if (count === 1) { /* empty */ }
  else if (repeat === 1) { count = 1 }
  else if (repeat > 0 && (count > repeat || count < -repeat)) {
    if (Build.BTypes & ~BrowserType.Chrome) {
      if (!overriddenCount) {
        set_cKey(lastKey)
        set_cOptions(null)
        set_cPort(port)
        set_cRepeat(count)
        confirm_<kCName, 1>(registryEntry.command_, abs(count), onLargeCountConfirmed.bind(null, registryEntry))
        return
      }
    } else {
      count = confirm_<kCName, 1>(registryEntry.command_, abs(count))! * (count < 0 ? -1 : 1)
    }
    if (!count) { return }
  } else { count = count || 1 }
  if (!registryEntry.background_) {
    const { alias_: fgAlias } = registryEntry,
    wantCSS = (kFgCmd.END <= 32 || fgAlias < 32) && <BOOL> (((
      (1 << kFgCmd.marks) | (1 << kFgCmd.passNextKey) | (1 << kFgCmd.focusInput)
    ) >> fgAlias) & 1)
        || fgAlias === kFgCmd.scroll && (!!options && (options as CmdOptions[kFgCmd.scroll]).keepHover === false)
    set_cPort(port)
    portSendFgCmd(port, fgAlias, wantCSS, options as any, count)
    return
  }
  const { alias_: alias } = registryEntry, func = BackgroundCommands[alias]
  // safe on renaming
  set_cKey(lastKey)
  set_cOptions(options || BgUtils_.safeObj_())
  set_cPort(port)
  set_cRepeat(count)
  count = BgCmdInfo[alias]
  if (count < Info.ActiveTab) {
    (func as BgCmdNoTab)()
  } else {
    set_gOnConfirmCallback(func as BgCmdCurWndTabs as any);
    (count < Info.CurWndTabsIfRepeat || count === Info.CurWndTabsIfRepeat && abs(cRepeat) < 2 ? getCurTab
        : Build.BTypes & BrowserType.Firefox && count > Info.CurWndTabs ? getCurShownTabs_ff_only!
        : getCurTabs)(/*#__NOINLINE__*/ executeCmdOnTabs)
  }
})
