/**
 * Simplified Chinese dictionary — the source of truth for the key set.
 *
 * `en-US.ts` is typed against this object, so adding a key here without
 * translating it there is a compile error. That is the whole point: a missing
 * translation becomes impossible to ship rather than showing up as an empty
 * label.
 */
export const zhCN = {
  app: {
    name: 'wheat tools',
    subtitle: '麦工具',
    tagline: '一个纯前端的小工具集合',
    /** Shown in the footer and on the About line. */
    builtWith: '由 DeepSeek Harness 0.2.0-rc.2 构建',
    builtWithShort: 'DeepSeek Harness 0.2.0-rc.2',
  },

  header: {
    toggleSidebar: '展开或收起侧边栏',
    expandSidebar: '展开侧边栏',
    collapseSidebar: '收起侧边栏',
    expandNav: '展开导航',
    collapseNav: '收起导航',
    themeToDark: '切换到深色主题',
    themeToLight: '切换到浅色主题',
    theme: '主题',
    themeSystem: '跟随系统',
    themeLight: '浅色',
    themeDark: '深色',
    designSpec: '设计规范：Fluent 2',
    language: '界面语言',
    switchLanguage: '切换语言',
    github: '在 GitHub 上查看源码',
  },

  nav: {
    home: '工具箱首页',
    expandAll: '全部展开',
    collapseAll: '全部收起',
    groups: '工具分类',
    localStorageNote: '本地保存 · 不上传',
    localStorageHint: '统计与收藏保存在浏览器本地（localStorage），不会上传',
    commonEmpty: '打开工具后，这里会按使用次数排序显示。',
    favoriteEmpty: '点击工具卡片右上角的星标即可收藏。',
    ariaLabel: '工具导航',
  },

  launcher: {
    title: '工具箱',
    subtitle: '共 {count} 个独立小工具，除「外网 IP 查询」需请求第三方接口外，其余全部在浏览器本地运行。',
    searchPlaceholder: '搜索工具…',
    noMatch: '没有匹配的工具',
    noMatchHint: '可以试试工具名、说明里的词，或清空搜索查看全部。',
    clearSearch: '清空搜索',
    searchLabel: '搜索工具',
    countOf: '{shown} / {total}',
    countTotal: '{total} 个工具',
    addFavorite: '收藏',
    removeFavorite: '取消收藏',
  },

  toolPage: {
    backToLauncher: '工具箱',
    notFound: '未找到工具 “{id}”',
    notFoundHint: '它可能已被移除，或链接有误。',
    back: '返回工具箱',
    version: 'v{version}',
    /**
     * Notice shown when a tool's internal copy has no translation yet.
     *
     * Stated plainly rather than hidden: a Chinese-only panel inside an English
     * interface looks like a bug unless it is explained.
     */
    contentNotTranslated: '该工具的内容目前只有中文。界面与工具说明已翻译，工具内的文字还在逐步补充。',
    loading: '正在加载「{name}」…',
    loadingGeneric: '正在加载工具…',
    loadingHint: '首次打开该工具需要下载它的代码，之后会立即打开。',
  },

  categories: {
    common: '常用工具',
    favorite: '我的收藏',
    dev: '编程工具',
    time: '时间工具',
    text: '文本与格式',
    crypto: '哈希与加密',
    network: '网络工具',
    media: '图片与媒体',
    other: '其它',
  },

  stopwatch: {
    elapsed: '已计时',
    ready: '按空格开始计时',
    running: '计时中…',
    paused: '已暂停',
    start: '开始',
    pause: '暂停',
    resume: '继续',
    lap: '计次',
    lapHint: '快捷键：空格 开始/暂停，L 计次，R 重置',
    reset: '重置',
    laps: '计次记录',
    noLaps: '开始计时后按「计次」记录分段用时。',
    lapNumber: '计次',
    split: '分段',
    total: '总时间',
    fastest: '最快分段',
    slowest: '最慢分段',
    copyLaps: '复制计次',
    lapFull: '计次已达上限 1000 条，请重置后重新开始。',
  },

  common: {
    copy: '复制',
    copied: '已复制',
    copyFailed: '复制失败',
    clear: '清空',
    reset: '重置',
    download: '下载',
    close: '关闭',
    search: '搜索',
    options: '选项',
    result: '结果',
    input: '输入',
    output: '输出',
    statistics: '统计',
    notes: '注意事项',
    warnings: '提示',
    examples: '示例',
    loadSample: '载入示例',
    addRow: '添加一行',
    delete: '删除',
    enable: '启用',
    true: '是',
    false: '否',
    none: '无',
  },

  footer: {
    local: '本地计算',
    localHint: '所有计算都在浏览器中完成，输入内容不会上传。',
    source: '源码',
    spec: '设计规范',
    built: '构建工具',
  },
};

/**
 * The dictionary shape every locale must provide.
 *
 * Deliberately *not* declared `as const`: literal types would force every other
 * locale to repeat the Chinese strings verbatim. The shape is what matters here,
 * and the compiler enforces it on every locale file.
 */
export type Dictionary = typeof zhCN;
