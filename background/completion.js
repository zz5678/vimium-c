"use strict";
var Completers;
setTimeout(function() {
  var HistoryCache, RankingUtils, RegexpCache, Decoder;

  Completers = {};

  function Suggestion(queryTerms, type, url, text, title, computeRelevancy, extraData) {
    this.queryTerms = queryTerms;
    this.type = type;
    this.url = url;
    this.text = text || url;
    this.title = title || "";
    this.relevancy = 0;
    this.relevancy = computeRelevancy(this, extraData);
  }

  Suggestion.prepareHtml = function(suggestion) {
    if (! suggestion.queryTerms) { return; }
    suggestion.titleSplit = suggestion.highlight1(suggestion.title);
    suggestion.text = Suggestion.shortenUrl(suggestion.text);
    suggestion.textSplit = suggestion.highlight1(suggestion.text);
    delete suggestion.queryTerms;
  };

  Suggestion.shortenUrl = function(url) {
    return url.substring((url.startsWith("http://")) ? 7 : (url.startsWith("https://")) ? 8 : 0,
      url.length - +(url.charCodeAt(url.length - 1) === 47));
  };

  Suggestion.prototype.pushMatchingRanges = function(string, term, ranges) {
    var index = 0, textPosition = 0, matchedEnd,
      splits = string.split(RegexpCache.get(term, "(", ")")),
      _ref = splits.length - 2;
    for (; index <= _ref; index += 2) {
      matchedEnd = (textPosition += splits[index].length) + splits[index + 1].length;
      ranges.push([textPosition, matchedEnd]);
      textPosition = matchedEnd;
    }
  };

  Suggestion.prototype.highlight1 = function(string) {
    var ranges = [], _i, _len, _ref = this.queryTerms;
    for (_i = 0, _len = _ref.length; _i < _len; ++_i) {
      this.pushMatchingRanges(string, _ref[_i], ranges);
    }
    if (ranges.length === 0) {
      return ranges;
    }
    ranges.sort(Suggestion.rsortBy0);
    return this.mergeRanges(ranges);
  };

  Suggestion.rsortBy0 = function(a, b) {
    return b[0] - a[0];
  };

  Suggestion.prototype.mergeRanges = function(ranges) {
    var mergedRanges = ranges.pop(), i = 1, range, ind = ranges.length;
    while (0 <= --ind) {
      range = ranges[ind];
      if (mergedRanges[i] >= range[0]) {
        if (mergedRanges[i] < range[1]) {
          mergedRanges[i] = range[1];
        }
      } else {
        mergedRanges.push(range[0], range[1]);
        i += 2;
      }
    };
    return mergedRanges;
  };

Completers.bookmarks = {
  bookmarks: undefined,
  currentSearch: null,
  filter: function(queryTerms, onComplete) {
    this.currentSearch = {
      queryTerms: queryTerms,
      onComplete: onComplete
    };
    if (this.bookmarks) {
      this.performSearch();
    }
    else if (this.bookmarks === undefined) {
      this.refresh();
    }
  },
  performSearch: function() {
    if (this.currentSearch.queryTerms.length === 0) {
      var onComplete = this.currentSearch.onComplete;
      this.currentSearch = null;
      onComplete([]);
      return;
    }
    var q = this.currentSearch.queryTerms, c = this.computeRelevancy, results, usePathAndTitle;
    usePathAndTitle = this.currentSearch.queryTerms.join("").indexOf('/') >= 0;
    results = this.bookmarks.filter(usePathAndTitle ? function(i) {
      return RankingUtils.matches(q, i.text + '\n' + i.path);
    } : function(i) {
      return RankingUtils.matches(q, i.text + '\n' + i.title);
    }).map(usePathAndTitle ? function(i) {
      return new Suggestion(q, "bookm", i.url, i.text, i.path, c);
    } : function(i) {
      return new Suggestion(q, "bookm", i.url, i.text, i.title, c);
    });
    var onComplete = this.currentSearch.onComplete;
    this.currentSearch = null;
    onComplete(results);
  },
  refresh: function() {
    this.bookmarks = null;
    chrome.bookmarks.getTree(this.readTree);
  },
  readTree: function(bookmarks) {
    this.bookmarks = this.traverseBookmarks(bookmarks).filter(this.GetUrl);
    Decoder.decodeList(this.bookmarks);
    if (this.currentSearch) {
      this.performSearch();
    }
  },
  GetUrl: function(b) {
    return b.url;
  },
  ignoreTopLevel: {
    "Bookmarks Bar": 1,
    "Other Bookmarks": 1,
    "Mobile Bookmarks": 1,
    "\u4E66\u7B7E\u680F": 1,
    "\u5176\u4ED6\u4E66\u7B7E": 1
  },
  traverseBookmarks: function(bookmarks) {
    var results = [], _this = this;
    bookmarks.forEach(function(folder) {
      _this.traverseBookmarksRecursive(folder, results, "");
    });
    return results;
  },
  traverseBookmarksRecursive: function(bookmark, results, path) {
    bookmark.path = !bookmark.title ? "" : path ? (path + '/' + bookmark.title)
      : (bookmark.title in this.ignoreTopLevel) ? "" : ('/' + bookmark.title);
    results.push(bookmark);
    if (bookmark.children) {
      var _this = this;
      bookmark.children.forEach(function(child) {
        _this.traverseBookmarksRecursive(child, results, bookmark.path);
      });
    }
  },
  computeRelevancy: function(suggestion) {
    return RankingUtils.wordRelevancy(suggestion.queryTerms, suggestion.text, suggestion.title);
  }
};
Completers.bookmarks.readTree = Completers.bookmarks.readTree.bind(Completers.bookmarks);

Completers.history = {
  filter: function(queryTerms, onComplete) {
    var _this = this;
    if (queryTerms.length > 0) {
      HistoryCache.use(function(history) {
        onComplete(history.filter(function(entry) {
          return RankingUtils.matches(queryTerms, entry.text + '\n' + entry.title);
        }).map(function(i) {
          return new Suggestion(queryTerms, "history", i.url, i.text, i.title, _this.computeRelevancy, i.lastVisitTime);
        }));
      });
      return;
    }
    chrome.sessions.getRecentlyClosed(null, function(sessions) {
      var historys = [], arr = {};
      sessions.forEach(function(entry) {
        if (!entry.tab || entry.tab.url in arr) { return; }
        entry.tab.lastVisitTime = entry.lastModified * 1000 + 60999;
        entry = entry.tab;
        arr[entry.url] = 1;
        historys.push(entry);
      });
      _this.filterFill(historys, onComplete, arr);
    });
  },
  filterFill: function(historys, onComplete, arr) {
    if (historys.length >= MultiCompleter.maxResults) {
      this.filterFinish(historys, onComplete);
      return;
    }
    var _this = this;
    chrome.history.search({
      text: "",
      maxResults: MultiCompleter.maxResults
    }, function(historys2) {
      var a = arr;
      historys2 = historys2.filter(function(i) {
        return !(i.url in a);
      });
      historys = historys.concat(historys2);
      _this.filterFinish(historys, onComplete);
    });
  },
  filterFinish: function(historys, onComplete) {
    var s = Suggestion, c = this.computeRelevancyByTime, d = Decoder.decodeURL;
    onComplete(historys.sort(this.rsortByLvt).slice(0, MultiCompleter.maxResults).map(function(e) {
      var o = new s([], "history", e.url, d(e.url), e.title, c, e.lastVisitTime);
      e.sessionId && (o.sessionId = e.sessionId);
      return o;
    }));
    Decoder.continueToWork();
  },
  rsortByLvt: function(a, b) {
    return b.lastVisitTime - a.lastVisitTime;
  },
  computeRelevancy: function(suggestion, lastVisitTime) {
    var recencyScore = RankingUtils.recencyScore(lastVisitTime),
      wordRelevancy = RankingUtils.wordRelevancy(suggestion.queryTerms, suggestion.text, suggestion.title);
    return recencyScore <= wordRelevancy ? wordRelevancy : (wordRelevancy + recencyScore) / 2;
  },
  computeRelevancyByTime: function(suggestion, lastVisitTime) {
    return RankingUtils.recencyScore(lastVisitTime);
  }
};

Completers.domains = {
  domains: null,
  filter: function(queryTerms, onComplete) {
    if (queryTerms.length !== 1 || queryTerms[0].indexOf("/") !== -1) {
      onComplete([]);
    } else if (this.domains) {
      this.performSearch(queryTerms, onComplete);
    } else {
      var _this = this;
      HistoryCache.use(function(history) {
        _this.populateDomains(history);
        _this.performSearch(queryTerms, onComplete);
      });
    }
  },
  performSearch: function(queryTerms, onComplete) {
    var domain, domainCandidates = [], query = queryTerms[0];
    for (domain in this.domains) {
      if (domain.indexOf(query) >= 0) {
        domainCandidates.push(domain);
      }
    }
    if (domainCandidates.length === 0) {
      onComplete([]);
      return;
    }
    domain = this.firstDomainByRelevancy(queryTerms, domainCandidates);
    onComplete([new Suggestion(queryTerms, "domain", domain, domain, null, this.computeRelevancy)]);
  },
  firstDomainByRelevancy: function(queryTerms, domainCandidates) {
    var domain, recencyScore, wordRelevancy, score, _i, _len, result = "", result_score = -1000;
    for (_i = 0, _len = domainCandidates.length; _i < _len; ++_i) {
      domain = domainCandidates[_i];
      recencyScore = RankingUtils.recencyScore(this.domains[domain].entry.lastVisitTime || 0);
      wordRelevancy = RankingUtils.wordRelevancy(queryTerms, domain, null);
      score = recencyScore <= wordRelevancy ? wordRelevancy : (wordRelevancy + recencyScore) / 2;
      if (score > result_score) {
        result_score = score;
        result = domain;
      }
    }
    return result;
  },
  populateDomains: function(history) {
    var callback = this.onPageVisited.bind(this);
    this.domains = {};
    history.forEach(callback);
    chrome.history.onVisited.addListener(callback);
    chrome.history.onVisitRemoved.addListener(this.onVisitRemoved.bind(this));
  },
  onPageVisited: function(newPage) {
    var domain = this.parseDomainAndScheme(newPage.url);
    if (domain) {
      var slot = this.domains[domain];
      if (slot) {
        if (slot.entry.lastVisitTime < newPage.lastVisitTime) {
          slot.entry = newPage;
        }
        ++ slot.referenceCount;
      } else {
        this.domains[domain] = {
          entry: newPage,
          referenceCount: 1
        };
      }
    }
  },
  onVisitRemoved: function(toRemove) {
    if (toRemove.allHistory) {
      this.domains = {};
      return;
    }
    var domains = this.domains, parse = this.parseDomainAndScheme;
    toRemove.urls.forEach(function(url) {
      var domain = parse(url);
      if (domain && domains[domain] && (-- domains[domain].referenceCount) === 0) {
        delete domains[domain];
      }
    });
  },
  parseDomainAndScheme: function(url) {
    return Utils.hasOrdinaryUrlPrefix(url) ? url.split("/", 3).join("/") : "";
  },
  computeRelevancy: function() {
    return 1;
  }
};

Completers.tabs = {
  filter: function(queryTerms, onComplete) {
    var _this = this;
    chrome.tabs.query({}, this.filter1.bind(this, queryTerms, onComplete));
  },
  filter1: function(queryTerms, onComplete, tabs) {
    var c = this.computeRelevancy, suggestions = tabs.filter(function(tab) {
      var text = Decoder.decodeURL(tab.url);
      if (RankingUtils.matches(queryTerms, text + '\n' + tab.title)) {
        tab.text = text;
        return true;
      }
      return false;
    }).map(function(tab) {
      var suggestion = new Suggestion(queryTerms, "tab", tab.url, tab.text, tab.title, c);
      suggestion.sessionId = tab.id;
      suggestion.favIconUrl = tab.favIconUrl;
      return suggestion;
    });
    onComplete(suggestions);
    Decoder.continueToWork();
  },
  computeRelevancy: function(suggestion) {
    return RankingUtils.wordRelevancy(suggestion.queryTerms, suggestion.text, suggestion.title);
  }
};

Completers.searchEngines = {
  engines: null,
  filter: function(queryTerms, onComplete) {
    var pattern = this.engines[queryTerms[0]];
    if (!pattern) {
      onComplete([]);
      return;
    }
    queryTerms.shift();
    var obj = Utils.createSearchUrl(pattern, queryTerms, true);
    onComplete([new Suggestion(queryTerms, "search", obj.url, obj.url
      , pattern.name + ": " + obj.$S, this.computeRelevancy)]);
  },
  computeRelevancy: function() {
    return 9;
  }
};

  function MultiCompleter(completers) {
    this.completers = completers;
    this.mostRecentQuery = false;
  }

  MultiCompleter.maxResults = 10;
  
  MultiCompleter.prototype.refresh = function() {
    for (var completer, _i = 0, _len = this.completers.length; _i < _len; ++_i) {
      completer = this.completers[_i];
      if (completer.refresh) {
        completer.refresh();
      }
    }
  };

  MultiCompleter.prototype.filter = function(queryTerms, onComplete) {
    if (this.mostRecentQuery) {
      if (arguments.length !== 0) {
        this.mostRecentQuery = {
          queryTerms: queryTerms,
          onComplete: onComplete
        };
        return;
      }
      queryTerms = this.mostRecentQuery.queryTerms;
      onComplete = this.mostRecentQuery.onComplete;
    }
    RegexpCache.clear();
    this.mostRecentQuery = true;
    var r = this.completers, i = 0, l = r.length, counter = l, suggestions = [], _this = this,
      callback = function(newSuggestions) {
        suggestions = suggestions.concat(newSuggestions);
        --counter;
        if (counter > 0) { return; }
        
        newSuggestions = null;
        suggestions.sort(_this.rsortByRelevancy);
        if (suggestions.length > MultiCompleter.maxResults) {
          suggestions = suggestions.slice(0, MultiCompleter.maxResults);
        }
        if (queryTerms.length > 0) {
          queryTerms[0] = Suggestion.shortenUrl(queryTerms[0]);
        }
        suggestions.forEach(Suggestion.prepareHtml);
        onComplete(suggestions);
        suggestions = null;
        if (typeof _this.mostRecentQuery === "object") {
          setTimeout(_this.filter.bind(_this), 0);
        } else {
          _this.mostRecentQuery = false;
        }
      };
    for (; i < l; i++) {
      r[i].filter(queryTerms, callback);
    };
  };
  
  MultiCompleter.prototype.rsortByRelevancy = function(a, b) {
    return b.relevancy - a.relevancy;
  }

  RankingUtils = {
    matches: function(queryTerms, thing) {
      var matchedTerm, regexp, _i, _len;
      for (_i = 0, _len = queryTerms.length; _i < _len; ++_i) {
        regexp = RegexpCache.get(queryTerms[_i], "", "");
        if (! thing.match(regexp)) {
          return false;
        }
      }
      return true;
    },
    matchWeights: {
      matchAnywhere: 1,
      matchStartOfWord: 1,
      matchWholeWord: 1,
      maximumScore: 3,
      recencyCalibrator: 2.0 / 3.0
    },
    _reduceLength: function(p, c) {
      return p - c.length;
    },
    scoreTerm: function(term, string) {
      var count, nonMatching, score;
      score = 0;
      count = 0;
      nonMatching = string.split(RegexpCache.get(term, "", ""));
      if (nonMatching.length > 1) {
        score = this.matchWeights.matchAnywhere;
        count = nonMatching.reduce(this._reduceLength, string.length);
        if (RegexpCache.get(term, "\\b", "").test(string)) {
          score += this.matchWeights.matchStartOfWord;
          if (RegexpCache.get(term, "\\b", "\\b").test(string)) {
            score += this.matchWeights.matchWholeWord;
          }
        }
      }
      return [score, count < string.length ? count : string.length];
    },
    wordRelevancy: function(queryTerms, url, title) {
      var c, maximumPossibleScore, s, term, titleCount, titleScore, urlCount, urlScore, _i, _len, _ref, _ref1;
      urlScore = titleScore = 0.0;
      urlCount = titleCount = 0;
      for (_i = 0, _len = queryTerms.length; _i < _len; ++_i) {
        term = queryTerms[_i];
        _ref = this.scoreTerm(term, url), s = _ref[0], c = _ref[1];
        urlScore += s;
        urlCount += c;
        if (title) {
          _ref1 = this.scoreTerm(term, title), s = _ref1[0], c = _ref1[1];
          titleScore += s;
          titleCount += c;
        }
      }
      maximumPossibleScore = this.matchWeights.maximumScore * queryTerms.length + 0.01;
      urlScore /= maximumPossibleScore;
      urlScore *= this.normalizeDifference(urlCount, url.length);
      if (!title) {
        return urlScore;
      }
      titleScore /= maximumPossibleScore;
      titleScore *= this.normalizeDifference(titleCount, title.length);
      return (urlScore < titleScore) ? titleScore : ((urlScore + titleScore) / 2);
    },
    timeCalibrator: 1000 * 60 * 60 * 24,
    timeAgo: Date.now() - 1000 * 60 * 60 * 24,
    recencyScore: function(lastAccessedTime) {
      var score = Math.max(0, lastAccessedTime - this.timeAgo) / this.timeCalibrator;
      return score * score * score * this.matchWeights.recencyCalibrator;
    },
    normalizeDifference: function(a, b) {
      var max = Math.max(a, b);
      return (max - Math.abs(a - b)) / max;
    }
  };

  RegexpCache = {
    _cache: {},
    clear: function() {
      this._cache = {};
    },
    escapeRe: Utils.escapeAllRe,
    get: function(s, p, n) {
      var r = p + s.replace(this.escapeRe, "\\$&") + n, v;
      return (v = this._cache)[r] || (v[r] = new RegExp(r, (this.upperRe.test(s) ? "" : "i")));
    },
    upperRe: Utils.upperRe
  };

  HistoryCache = {
    size: 20000,
    history: null,
    callbacks: [],
    reset: function() {
      this.history = null;
      this.callbacks = [];
    },
    use: function(callback) {
      if (! this.history) {
        this.fetchHistory(callback);
        return;
      }
      callback(this.history);
    },
    fetchHistory: function(callback) {
      this.callbacks.push(callback);
      if (this.callbacks.length > 1) {
        return;
      }
      var _this = this;
      chrome.history.search({
        text: "",
        maxResults: this.size,
        startTime: 0
      }, function(history) {
        history.sort(function(a, b) { return a.url.localeCompare(b.url); });
        Decoder.decodeList(history);
        _this.history = history;
        chrome.history.onVisited.addListener(_this.onPageVisited.bind(_this));
        chrome.history.onVisitRemoved.addListener(_this.onVisitRemoved.bind(_this));
        for (var i = 0, len = _this.callbacks.length, callback; i < len; ++i) {
          callback = _this.callbacks[i];
          callback(_this.history);
        }
        _this.callbacks = [];
      });
    },
    onPageVisited: function(newPage) {
      var i = this.binarySearch(newPage.url, this.history);
      if (i >= 0) {
        var old = this.history[i];
        this.history[i] = newPage;
        if (old.text !== old.url) {
          newPage.text = old.text;
          return;
        }
      } else {
        this.history.splice(-1 - i, 0, newPage);
      }
      Decoder.decodeList([newPage]);
    },
    onVisitRemoved: function(toRemove) {
      if (toRemove.allHistory) {
        this.reset();
        return;
      }
      var bs = this.binarySearch, h = this.history;
      toRemove.urls.forEach(function(url) {
        var i = bs(url, h);
        if (i >= 0) {
          h.splice(i, 1);
        }
      });
    },
    binarySearch: function(u, a) {
      var e, h = a.length - 1, l = 0, m = 0;
      while (l <= h) {
        m = Math.floor((l + h) / 2);
        e = a[m].url.localeCompare(u);
        if (e > 0) { h = m - 1; }
        else if (e < 0) { l = m + 1; }
        else { return m; }
      }
      e = a[m].url;
      if (e < u) { return -2 - m; }
      return -1 - m;
    }
  };

  Decoder = {
    _f: decodeURIComponent, // core function
    decodeURL: null,
    decodeList: function(a) {
      var i = -1, j, l = a.length, d = Decoder, f = d._f;
      for (; ; ) {
        try {
          while (++i < l) {
            j = a[i];
            j.text = f(j.url);
          }
          break;
        } catch (e) {
          j.text = d.dict[j.url] || (d.todos.push(j), j.url);
        }
      }
      d.continueToWork();
    },
    dict: {},
    todos: [], // each item is either {url: ...} or "url"
    _timer: 0,
    charset: "GBK",
    working: -1,
    interval: 25,
    continueToWork: function() {
      if (this._timer === 0 && this.todos.length > 0) {
        this._timer = setInterval(this.Work, this.interval);
      }
    },
    Work: function() {
      var _this = Decoder;
      if (_this.working === -1) {
        _this.init();
        _this.working = 0;
      }
      if (! _this.todos.length) {
        clearInterval(_this._timer);
        _this._timer = 0;
        _this._link.href = "";
      } else if (_this.working === 0) {
        var url = _this.todos[0];
        if (url.url) {
          url = url.url;
        }
        if (_this.dict[url]) {
          _this.todos.shift();
        } else {
          _this.working = 1;
          _this._link.href = "data:text/css;charset=" + _this.charset + ",%23" + _this._id //
            + "%7Bfont-family%3A%22" + url + "%22%7D";
        }
      } else if (_this.working === 1) {
        _this.working = 2;
        var text = window.getComputedStyle(_this._div).fontFamily, url = _this.todos.shift();
        if (url.url) {
          _this.dict[url.url] = url.text = text = text.substring(1, text.length - 1);
          url = url.url;
        } else {
          _this.dict[url] = text = text.substring(1, text.length - 1);
        }
        _this.working = 0;
        _this.Work();
      }
    },
    _id: "_decode",
    _link: null,
    _div: null,
    init: function() {
      var link = this._link = document.createElement('link'),
          div = this._div = document.createElement('div');
      link.rel = 'stylesheet';
      link.type = 'text/css';
      div.id = this._id;
      div.style.display = 'none';
      document.body.appendChild(link);
      document.body.appendChild(div);
    }
  };
  
  setTimeout(function() {
    (function() {
      var d = Decoder.dict, f = Decoder._f, t = Decoder.todos;
      Decoder.decodeURL = function(a) {
        try {
          return f(a);
        } catch (e) {
          return d[a] || (t.push(a), a);
        }
      };
    })();

    var lang = Settings.get("UILanguage");
    if (!lang || !(lang = lang[chrome.i18n.getUILanguage()])) {
      return;
    }
    var ref = lang.urlCharset;
    if (ref && typeof ref === "string") {
      Decoder.charset = ref;
    }
    ref = lang.bookmarkTitles;
    if (ref && ref.length > 0) {
      var i = ref.length, ref2 = Completers.bookmarks.completers[0].ignoreTopLevel;
      ref.sort().reverse();
      for (; 0 <= --i; ) {
        ref2[ref[i]] = 1;
      }
    }
  }, 100);

  Settings.updateHooks.searchEnginesMap = (function(func, value) {
    func.call(Settings, value);
    this.engines = value;
  }).bind(Completers.searchEngines, Settings.updateHooks.searchEnginesMap);
  Completers.searchEngines.engines = Settings.get("searchEnginesMap");

  Completers = {
    omni: new MultiCompleter([Completers.searchEngines, Completers.bookmarks, Completers.history, Completers.domains]),
    bookmarks: new MultiCompleter([Completers.bookmarks]),
    history: new MultiCompleter([Completers.history]),
    tabs: new MultiCompleter([Completers.tabs])
  };

  Utils.Decoder = Decoder;

}, 120);