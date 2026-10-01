/**
 * Git command reference data.
 *
 * Organised by what the user is trying to do, not by command name: nobody looks
 * up "how do I undo a commit" by remembering that the answer starts with the
 * letter r.
 *
 * Commands and their semantics are taken from the official manual, one page per
 * command under https://git-scm.com/docs (git-status, git-reset, git-clean,
 * git-rebase, git-push, git-reflog, git-bisect, ...). Only commands whose
 * behaviour could be confirmed there are listed.
 *
 * ## Why the danger level is data, not prose
 *
 * A cheat sheet that presents `git reset --hard` and `git status` in the same
 * neutral tone is actively harmful: one of them deletes work that Git cannot
 * bring back. The level is therefore a field, and scripts/check-git-cheatsheet.mjs
 * asserts it against the command's semantics — destructive commands must be
 * `danger`, read-only ones must be `safe` — so the classification cannot drift
 * away from the truth as entries are added.
 *
 * Nothing here executes anything. The tool renders text; there is no shell, no
 * child process and no repository access.
 */

export type DangerLevel = 'safe' | 'caution' | 'danger';

export interface DangerMeta {
  label: string;
  /** What the level means for the user's data. */
  detail: string;
}

export interface GitCommand {
  /** The command, with `<占位符>` for the parts the user must fill in. */
  command: string;
  /** One sentence: what it does. */
  summary: string;
  /** When you would reach for it. */
  scenario: string;
  danger: DangerLevel;
  /**
   * How to get back if it went wrong. Required for `danger`: a warning without
   * a way out is just noise.
   */
  recovery?: string;
}

export interface GitGroup {
  id: string;
  title: string;
  note?: string;
  entries: GitCommand[];
}

/**
 * The three levels.
 *
 * The definition is about data, not about how scary the command looks:
 * `safe` cannot lose anything, `caution` is recoverable from Git's own
 * records, `danger` can lose work for good or rewrite history other people
 * already have.
 */
export const DANGER_META: Record<DangerLevel, DangerMeta> = {
  safe: {
    label: '安全',
    detail: '只读，或只做加法：不会覆盖、删除或改写任何已有内容。',
  },
  caution: {
    label: '注意',
    detail: '会改写工作区、暂存区或本地历史，但 Git 留有记录，通常可以恢复；执行前先看清当前状态。',
  },
  danger: {
    label: '危险',
    detail:
      '可能永久丢掉未提交的内容，或改写已经推送的历史影响他人；多数学会只能靠 reflog 或备份补救，有的完全无法补救。',
  },
};

/**
 * The placeholder convention.
 *
 * Every angle-bracketed token used anywhere in this file must appear here, and
 * the check enforces both directions. One spelling per concept (`<分支名>`,
 * never `<branch>` or `<BRANCH>`) is what keeps the table greppable.
 */
export const PLACEHOLDERS: Array<{ token: string; meaning: string }> = [
  { token: '<文件>', meaning: '文件或目录路径，可以写多个' },
  { token: '<提交>', meaning: '提交哈希、标签、分支名，或 HEAD~1 这类引用' },
  { token: '<分支名>', meaning: '已存在的分支名' },
  { token: '<新分支名>', meaning: '要新建的分支名' },
  { token: '<远程名>', meaning: '远程仓库名，通常是 origin' },
  { token: '<地址>', meaning: '仓库地址（URL 或本地路径）' },
  { token: '<标签名>', meaning: '标签名，例如 v1.2.0' },
  { token: '<说明>', meaning: '提交信息或暂存说明的文本' },
  { token: '<字符串>', meaning: '要搜索的文本' },
  { token: '<旧路径>', meaning: '重命名前的路径' },
  { token: '<新路径>', meaning: '重命名后的路径' },
];

const REFLOG_HINT =
  '被移走的提交不会立刻消失：git reflog 能找到它，再用 git branch <分支名> <提交> 或 git reset --hard <提交> 恢复。';

export const GIT_GROUPS: GitGroup[] = [
  {
    id: 'daily',
    title: '日常提交',
    note: '改完代码到留下一个提交之间的动作',
    entries: [
      {
        command: 'git status',
        summary: '显示当前分支、暂存区内容与未跟踪文件。',
        scenario: '每次动手之前和提交之前的第一条命令：先确认自己在哪个分支、有哪些改动。',
        danger: 'safe',
      },
      {
        command: 'git status -s',
        summary: '用两列短格式输出状态，一行一个文件。',
        scenario: '改动很多时想要一个紧凑的清单，或者想复制给别人看。',
        danger: 'safe',
      },
      {
        command: 'git add <文件>',
        summary: '把指定文件的改动放进暂存区，等待提交。',
        scenario: '按文件挑选这次提交要包含的内容；只做加法，不会覆盖已有内容。',
        danger: 'safe',
      },
      {
        command: 'git add -p',
        summary: '逐块询问是否暂存，可以只提交同一个文件里的部分改动。',
        scenario: '一个文件里混着两件事的改动，想把它们拆成两个提交。',
        danger: 'safe',
      },
      {
        command: 'git add -A',
        summary: '暂存所有改动，包括新建和删除的文件。',
        scenario: '确认过 git status 之后想一次性全部暂存。',
        danger: 'safe',
      },
      {
        command: 'git commit -m "<说明>"',
        summary: '把暂存区的内容记录成一个新提交。',
        scenario: '完成一小段可描述的工作之后。提交只是追加，历史不会因此丢失。',
        danger: 'safe',
      },
      {
        command: 'git commit -a -m "<说明>"',
        summary: '跳过暂存步骤，直接提交所有已跟踪文件的改动。',
        scenario: '改动都集中在已跟踪文件里，且确定没有想拆分的部分。注意它对新建文件无效。',
        danger: 'safe',
      },
      {
        command: 'git commit --amend',
        summary: '用暂存区的内容重写最后一个提交，并可以顺手改提交信息。',
        scenario: '刚提交完就发现漏了一个文件或写错了说明，且这个提交还没有推送。',
        danger: 'caution',
        recovery:
          '旧提交仍在 reflog 里，git reset --hard <提交> 可以回到重写前的位置；如果已经推送过，改写远端还需要 git push --force-with-lease。',
      },
      {
        command: 'git commit --fixup <提交>',
        summary: '生成一个专门用来修补某个旧提交的 fixup 提交。',
        scenario: '配合 git rebase -i --autosquash 把零散的小修整合进原来的提交。',
        danger: 'safe',
      },
      {
        command: 'git mv <旧路径> <新路径>',
        summary: '移动或重命名文件，并把这次改名记入暂存区。',
        scenario: '整理目录结构，并且希望 git log --follow 能继续追踪这个文件。',
        danger: 'safe',
      },
      {
        command: 'git rm <文件>',
        summary: '从工作区和暂存区同时删除文件。',
        scenario: '确认某个已提交的文件不再需要。内容还在历史提交里，所以是可恢复的。',
        danger: 'caution',
        recovery: '用 git restore --source=HEAD --staged --worktree <文件> 从最后一个提交里把它取回来。',
      },
    ],
  },
  {
    id: 'branch',
    title: '分支',
    note: '创建、切换、合并与删除分支',
    entries: [
      {
        command: 'git branch',
        summary: '列出本地分支，当前分支前面带一个星号。',
        scenario: '想知道本机有哪些分支、自己现在在哪一个上。',
        danger: 'safe',
      },
      {
        command: 'git branch -a',
        summary: '列出本地分支以及所有远程跟踪分支。',
        scenario: '准备推送或拉取之前，确认远端有哪些分支可用。',
        danger: 'safe',
      },
      {
        command: 'git branch <分支名>',
        summary: '在当前提交上新建一个分支，但不切换过去。',
        scenario: '想给当前位置留一个名字再继续往前走。',
        danger: 'safe',
      },
      {
        command: 'git branch -m <分支名>',
        summary: '把当前分支改名。',
        scenario: '分支名写错了，或者本地分支名与远端命名规范不一致。',
        danger: 'caution',
        recovery: '旧的本地分支名会留在 reflog 中，可以再改回去；但如果已经推送过，远端分支需要另外处理。',
      },
      {
        command: 'git switch <分支名>',
        summary: '切换到已有分支，并更新工作区内容。',
        scenario: '换一条工作线继续改代码。如果有未提交的改动会被覆盖，Git 会拒绝切换而不是丢掉它们。',
        danger: 'caution',
        recovery: '切错分支只需要再 git switch 回来；未提交的改动不会被吞掉，Git 会拒绝危险的切换。',
      },
      {
        command: 'git switch -c <新分支名>',
        summary: '新建分支并立即切换过去。',
        scenario: '开始一个新功能或修复，且不想影响当前分支。',
        danger: 'caution',
        recovery: '切回原分支即可，新分支可以留着或删掉。',
      },
      {
        command: 'git merge <分支名>',
        summary: '把指定分支的改动合并进当前分支，可能产生合并提交。',
        scenario: '功能分支完成后并回主分支。冲突时可以用 git merge --abort 原样退出。',
        danger: 'caution',
        recovery: '合并中途出错用 git merge --abort；已经生成的合并提交用 git reset --hard <提交> 或 git revert <提交> 撤回。',
      },
      {
        command: 'git rebase <分支名>',
        summary: '把当前分支的提交逐个摘下来，重新接到目标分支之后，等于改写这些提交。',
        scenario: '想在上游分支之上保持一条干净的线性历史，且这些提交只存在于本地。',
        danger: 'danger',
        recovery: `rebase 会新建提交、丢弃原来的提交对象，原位置只记在 reflog 与 ORIG_HEAD 里：git reflog 找到 rebase 之前的条目，再 git reset --hard <提交>。已推送过的分支不要 rebase，除非确定要改写远端。`,
      },
      {
        command: 'git branch -d <分支名>',
        summary: '删除已经合并进当前分支的本地分支。',
        scenario: '功能分支合并完之后清理。未合并时 Git 会拒绝删除，这个保护是有意的。',
        danger: 'caution',
        recovery: REFLOG_HINT,
      },
      {
        command: 'git branch -D <分支名>',
        summary: '强制删除本地分支，即使它还有没合并的提交。',
        scenario: '确认这个分支的提交已经用别的方式保留（比如另一条分支或已合并的 PR）之后才使用。',
        danger: 'danger',
        recovery: `分支被删后它的提交不再有分支指向，却仍在 reflog 和对象库里：git reflog 找到该分支最后一次提交，再 git branch <分支名> <提交> 重建。超过 gc 周期或手动 gc 之后可能真的消失。`,
      },
      {
        command: 'git tag -a <标签名> -m "<说明>"',
        summary: '创建一个带说明的附注标签，指向当前提交。',
        scenario: '标记一次发布。标签默认不会被 git push 带上去，需要显式推送。',
        danger: 'safe',
      },
    ],
  },
  {
    id: 'undo',
    title: '撤销与回退',
    note: '这一组最容易丢数据，先读危险等级再动手',
    entries: [
      {
        command: 'git restore <文件>',
        summary: '把工作区里的指定文件恢复成暂存区的样子，未暂存的改动被丢弃。',
        scenario: '想撤销某个文件里还没暂存的修改，而且确定这些改动不需要保留。',
        danger: 'danger',
        recovery: '未提交的改动不在 Git 对象库里，删除后无法用 reflog 找回；只能用编辑器或 IDE 的本地历史补救。',
      },
      {
        command: 'git restore --staged <文件>',
        summary: '把文件从暂存区撤出，工作区内容原样保留。',
        scenario: 'git add 多了文件，想把它留到下一次提交。',
        danger: 'caution',
        recovery: '改动仍在工作区，重新 git add 即可恢复暂存状态。',
      },
      {
        command: 'git checkout -- <文件>',
        summary: '旧写法的恢复文件，效果等同于 git restore <文件>，会丢弃工作区改动。',
        scenario: '老脚本或肌肉记忆里还在用；新代码建议改用 git restore。',
        danger: 'danger',
        recovery: '同 git restore <文件>：未提交的改动无法用 Git 找回。',
      },
      {
        command: 'git checkout .',
        summary: '丢弃当前目录下所有未暂存的改动。',
        scenario: '几乎总是误操作。真想清理时先 git status 看清会失去什么。',
        danger: 'danger',
        recovery: '没有任何 Git 内置的找回手段：这些改动从未进入对象库。',
      },
      {
        command: 'git restore .',
        summary: 'git restore <文件> 的批量版本，丢弃当前目录下所有未暂存改动。',
        scenario: '和 git checkout . 一样危险，只是写法更新。执行前先 git status。',
        danger: 'danger',
        recovery: '未提交的改动无法用 reflog 找回。',
      },
      {
        command: 'git reset <提交>',
        summary: '把当前分支指向另一个提交，暂存区重置，工作区保持不变。',
        scenario: '想撤销最近的提交但保留文件改动，重新组织成更合适的提交。',
        danger: 'caution',
        recovery: REFLOG_HINT,
      },
      {
        command: 'git reset --soft <提交>',
        summary: '只移动分支指针，暂存区和工作区都不动。',
        scenario: '把最近几个提交压成一个：先 soft reset 回去，再重新提交。',
        danger: 'caution',
        recovery: REFLOG_HINT,
      },
      {
        command: 'git reset --hard <提交>',
        summary: '把分支指针、暂存区和工作区一起重置到指定提交，未提交的改动全部消失。',
        scenario: '确认本地一切都不需要了，想彻底回到某个已知状态。这是本表里最容易造成损失的命令之一。',
        danger: 'danger',
        recovery: `未提交的改动无法找回；被移走的提交本身还在 reflog 里，可以用 git reflog 找到旧位置后 git reset --hard <提交>。先做这一步确认，再执行命令。`,
      },
      {
        command: 'git clean -n',
        summary: '列出会被 git clean 删除的未跟踪文件，但不真的删除。',
        scenario: '每次准备执行 git clean -fd 之前都应该先跑它。',
        danger: 'safe',
      },
      {
        command: 'git clean -fd',
        summary: '删除所有未跟踪的文件和目录，包括从没提交过的成果。',
        scenario: '只在确认工作区里没有任何有价值的新文件时使用，例如构建产物或临时脚本。',
        danger: 'danger',
        recovery:
          '未跟踪文件从未进入 Git 对象库，reflog 里也没有它们，删除后 Git 无法恢复。执行前先 git clean -n 看清清单，或先备份目录。',
      },
      {
        command: 'git revert <提交>',
        summary: '生成一个反向提交来抵消指定提交，历史本身不被改写。',
        scenario: '撤销已经推送、别人可能已经拉取的提交——这是这种情况下的正确做法。',
        danger: 'safe',
      },
    ],
  },
  {
    id: 'history',
    title: '查看历史',
    note: '全部只读，随便试',
    entries: [
      {
        command: 'git log',
        summary: '按时间倒序列出当前分支的提交。',
        scenario: '想了解最近的改动，或者找到要引用的提交哈希。',
        danger: 'safe',
      },
      {
        command: 'git log --oneline --graph --decorate --all',
        summary: '一行一个提交，画出分支走向，标出分支与标签位置。',
        scenario: '合并前后想一眼看清分支结构。',
        danger: 'safe',
      },
      {
        command: 'git log -p <文件>',
        summary: '显示每个提交对该文件的具体改动。',
        scenario: '追查某一行是谁、在哪次提交里改的。',
        danger: 'safe',
      },
      {
        command: 'git log -S "<字符串>"',
        summary: '只显示那些增删过指定字符串的提交（pickaxe 搜索）。',
        scenario: '记得某个函数名或配置项，却不知道它是什么时候出现或消失的。',
        danger: 'safe',
      },
      {
        command: 'git show <提交>',
        summary: '显示某个提交的元信息和完整改动。',
        scenario: '审查一次具体提交，或者确认某次改动到底做了什么。',
        danger: 'safe',
      },
      {
        command: 'git show <提交>:<文件>',
        summary: '输出某个提交里该文件当时的内容。',
        scenario: '想对比现在的代码和某个历史版本，而不想切分支。',
        danger: 'safe',
      },
      {
        command: 'git diff',
        summary: '显示工作区与暂存区之间的差异。',
        scenario: '提交之前自查到底改了什么。',
        danger: 'safe',
      },
      {
        command: 'git diff --staged',
        summary: '显示暂存区与最后一次提交之间的差异。',
        scenario: '确认即将提交的内容就是自己以为的那些。',
        danger: 'safe',
      },
      {
        command: 'git diff <提交>..<提交>',
        summary: '比较两个提交之间的差异。',
        scenario: '合并前审查一个分支相对另一个分支多了什么。',
        danger: 'safe',
      },
      {
        command: 'git shortlog -sn',
        summary: '按作者统计提交数量。',
        scenario: '快速了解一个仓库的参与者分布。',
        danger: 'safe',
      },
      {
        command: 'git describe --tags',
        summary: '用最近的标签加距离描述当前提交。',
        scenario: '构建产物需要一个人类可读的版本身份。',
        danger: 'safe',
      },
    ],
  },
  {
    id: 'stash',
    title: '暂存改动',
    note: '把做到一半的改动先收起来',
    entries: [
      {
        command: 'git stash push -m "<说明>"',
        summary: '把已跟踪文件的改动收进一个带说明的暂存条目，工作区回到 HEAD。',
        scenario: '临时要切去处理别的事，又不想为半成品建一个提交。',
        danger: 'caution',
        recovery: 'git stash list 找到条目后 git stash pop 取回；条目被误删也还能通过 git fsck --unreachable 尝试找回。',
      },
      {
        command: 'git stash -u',
        summary: '收起来的改动同时包含未跟踪文件。',
        scenario: '半成品里有新建文件时，普通的 git stash 会漏掉它们。',
        danger: 'caution',
        recovery: '同 git stash push，用 git stash pop 取回。',
      },
      {
        command: 'git stash list',
        summary: '列出所有暂存条目及其编号。',
        scenario: '取回之前先看清有几条、哪一条是自己要的。',
        danger: 'safe',
      },
      {
        command: 'git stash show -p stash@{0}',
        summary: '显示最新一条暂存的完整改动。',
        scenario: '条目多了之后，取回之前先确认内容是不是自己想的那一份。',
        danger: 'safe',
      },
      {
        command: 'git stash apply',
        summary: '把最新暂存应用到工作区，条目本身保留。',
        scenario: '不确定应用后会不会冲突，想留一条退路时用它而不是 pop。',
        danger: 'caution',
        recovery: 'stash 条目仍在列表里，随时可以重来或用 git checkout 之类的命令撤销工作区改动。',
      },
      {
        command: 'git stash pop',
        summary: '应用最新暂存并在成功之后删除该条目。',
        scenario: '确定不再需要这条暂存时使用。有冲突时 Git 会保留条目，不会静默丢弃。',
        danger: 'caution',
        recovery: '若条目已被删除，可以用 git fsck --unreachable 找到悬空提交再 git stash apply <提交>。',
      },
      {
        command: 'git stash branch <分支名>',
        summary: '基于暂存创建时的提交新建分支，并把暂存应用上去。',
        scenario: '暂存放了很久，直接 pop 到当前分支会冲突，不如从原位置开一条分支。',
        danger: 'caution',
        recovery: '新分支可以随时删除；暂存内容已应用到分支上，不会凭空消失。',
      },
      {
        command: 'git stash drop',
        summary: '删除指定的暂存条目。',
        scenario: '确认某条暂存已经没用了。删除是不可逆操作，先看清条目编号。',
        danger: 'danger',
        recovery:
          'stash 条目本质是提交对象，删除后短期内仍可用 git fsck --unreachable 找到悬空提交，再 git stash apply <提交>；时间久了会被 gc 回收。',
      },
      {
        command: 'git stash clear',
        summary: '删除所有暂存条目。',
        scenario: '几乎只应该在确定所有暂存都已无用之后执行。',
        danger: 'danger',
        recovery: '同 git stash drop：只能靠 git fsck --unreachable 抢救，而且不保证成功。',
      },
    ],
  },
  {
    id: 'remote',
    title: '远程协作',
    note: '拉取、推送与远端分支',
    entries: [
      {
        command: 'git remote -v',
        summary: '列出远程仓库名及其地址。',
        scenario: '确认自己推送到哪里、拉取来自哪里。',
        danger: 'safe',
      },
      {
        command: 'git remote add <远程名> <地址>',
        summary: '登记一个新的远程仓库。',
        scenario: '要给本地仓库接上另一个远端，例如自己的 fork。',
        danger: 'safe',
      },
      {
        command: 'git fetch <远程名>',
        summary: '下载远端的新提交和分支，只更新远程跟踪分支，不碰工作区。',
        scenario: '想先看看远端有什么变化，再决定要不要合并。',
        danger: 'safe',
      },
      {
        command: 'git fetch --prune',
        summary: '拉取更新的同时清掉远端已经删除的跟踪分支。',
        scenario: '远端分支删了很多，本地列表越来越乱。',
        danger: 'safe',
      },
      {
        command: 'git pull <远程名> <分支名>',
        summary: '等于 fetch 之后再做一次 merge，可能产生合并提交或冲突。',
        scenario: '本地没有额外提交时最省事；有本地提交时先想清楚要不要 rebase。',
        danger: 'caution',
        recovery: '合并冲突可以用 git merge --abort 退出；已经产生的合并提交用 git reset --hard <提交> 撤回，或用 git revert <提交> 生成反向提交。',
      },
      {
        command: 'git pull --rebase',
        summary: 'fetch 之后用 rebase 而不是 merge 接上本地提交，本地提交会被改写。',
        scenario: '希望历史保持线性，且本地这些提交还没有推送。',
        danger: 'danger',
        recovery:
          '它和 git rebase 一样改写本地提交。中途出错可以 git rebase --abort 原样退出；完成后发现不对，用 git reflog 找到 ORIG_HEAD 之前的位置，再 git reset --hard <提交>。已经推送过的本地提交不要这样接，除非确定要强推。',
      },
      {
        command: 'git push <远程名> <分支名>',
        summary: '把本地分支的提交上传到远端。',
        scenario: '工作告一段落、需要备份或请别人审查时。它只追加历史，不会删掉本地任何东西。',
        danger: 'caution',
        recovery: '推送本身不丢失本地数据；如果推错了分支，可以在远端删除该分支，或继续往前推新的提交来修正。',
      },
      {
        command: 'git push -u <远程名> <分支名>',
        summary: '推送的同时把这个远端分支设为本地分支的上游。',
        scenario: '第一次推送新分支，之后就可以直接写 git push、git pull。',
        danger: 'caution',
        recovery: '只是设置了一个配置项；用 git branch --unset-upstream 可以撤掉。',
      },
      {
        command: 'git push <远程名> --delete <分支名>',
        summary: '删除远端的分支。',
        scenario: '功能分支已经合并，远端还要留一份就没人清理了。',
        danger: 'caution',
        recovery: '只要你本地还有这个分支，重新推送一次就能恢复：git push <远程名> <分支名>。',
      },
      {
        command: 'git push --force',
        summary: '用本地历史强行覆盖远端分支，远端独有的提交会被丢掉。',
        scenario: '几乎总是应该改用 --force-with-lease；只有在明确知道自己覆盖什么时才用。',
        danger: 'danger',
        recovery:
          '被覆盖的远端提交在服务器上可能仍在 reflog 里，但普通用户拿不到；本地的旧提交要靠自己的 git reflog 找。推之前最好先 git fetch 并留一份备份分支。',
      },
      {
        command: 'git push --force-with-lease',
        summary: '在远端没有别人的新提交时才允许强推，比 --force 安全一档。',
        scenario: 'rebase 或 amend 之后必须强推时，这是默认选择。',
        danger: 'danger',
        recovery:
          '它仍然改写远端历史，别人的提交不会因此丢，但已经拉取旧历史的同事需要手动对齐；本地旧位置用 git reflog 找回。',
      },
      {
        command: 'git cherry-pick <提交>',
        summary: '把指定提交的改动复制到当前分支，生成一个新的提交。',
        scenario: '只要某个分支上的一个修复，不想合并整条分支。',
        danger: 'caution',
        recovery: '中途冲突用 git cherry-pick --abort；已经生成的提交用 git reset --hard <提交> 撤回。',
      },
    ],
  },
  {
    id: 'debug',
    title: '排查问题',
    note: '定位是哪个提交引入了问题',
    entries: [
      {
        command: 'git bisect start',
        summary: '进入二分查找模式，开始在提交历史里定位问题。',
        scenario: '知道某个旧版本是好的、现在坏了，但不知道是哪次提交造成的。',
        danger: 'caution',
        recovery: '任何时候用 git bisect reset 退出二分模式并回到原来的分支，不会丢数据。',
      },
      {
        command: 'git bisect good <提交>',
        summary: '告诉 bisect 这个提交是正常的。',
        scenario: 'bisect 每次检出中间提交后，测试并标记结果。',
        danger: 'caution',
        recovery: 'git bisect reset 退出；标记过程不改写历史。',
      },
      {
        command: 'git bisect bad <提交>',
        summary: '告诉 bisect 这个提交有问题。',
        scenario: '与 good 交替使用，几次之后就能锁定第一个有问题的提交。',
        danger: 'caution',
        recovery: 'git bisect reset 退出。',
      },
      {
        command: 'git bisect reset',
        summary: '结束二分查找，回到开始之前的位置。',
        scenario: '找到问题提交之后，或者中途想放弃时。',
        danger: 'caution',
        recovery: '它本身就是恢复动作；如果忘了自己在哪，git reflog 也能看到之前的位置。',
      },
      {
        command: 'git reflog',
        summary: '列出 HEAD 和分支引用的移动记录，包括已被 reset 或 rebase 丢弃的提交。',
        scenario: '误删分支、reset --hard 之后想找回提交时，这是第一站。条目默认保留 90 天。',
        danger: 'safe',
      },
      {
        command: 'git blame <文件>',
        summary: '逐行显示最后修改该行的提交、作者和时间。',
        scenario: '想弄清某行代码的来历，再结合 git show 看上下文。',
        danger: 'safe',
      },
      {
        command: 'git grep <字符串> <提交>',
        summary: '在指定提交的代码树里搜索文本。',
        scenario: '想知道某个字符串在过去某个版本里是否存在、出现在哪些文件。',
        danger: 'safe',
      },
      {
        command: 'git log --oneline --all --graph',
        summary: '用一行的形式画出所有分支的提交图。',
        scenario: '怀疑改动来自另一条分支，需要先看清整体走向。',
        danger: 'safe',
      },
    ],
  },
];

export interface SearchHit {
  entry: GitCommand;
  group: GitGroup;
}

/** Every entry with its owning group, in group order. */
export function flattenCommands(): SearchHit[] {
  return GIT_GROUPS.flatMap((group) => group.entries.map((entry) => ({ entry, group })));
}

/**
 * Splits a query into lower-cased terms.
 *
 * Whitespace separates terms and all of them must match (AND), which is what
 * makes `撤销 提交` narrow rather than widen a search. Chinese has no word
 * boundaries, so a single character works the same as a multi-character term.
 */
export function queryTerms(query: string): string[] {
  return query.trim().toLowerCase().split(/\s+/).filter(Boolean);
}

/**
 * Searches command, description, scenario, section title and danger label.
 *
 * All fields are searched because people remember different things: the command
 * name, the sentence describing it, or the situation they were in.
 */
export function searchCommands(query: string): SearchHit[] {
  const terms = queryTerms(query);
  const all = flattenCommands();
  if (terms.length === 0) return all;

  return all.filter(({ entry, group }) => {
    const fields = [
      entry.command,
      entry.summary,
      entry.scenario,
      group.title,
      DANGER_META[entry.danger].label,
      entry.recovery ?? '',
    ].map((field) => field.toLowerCase());
    return terms.every((term) => fields.some((field) => field.includes(term)));
  });
}

/** All placeholder tokens used by a string, in order of appearance. */
export function placeholdersIn(text: string): string[] {
  return text.match(/<[^<>]+>/g) ?? [];
}
