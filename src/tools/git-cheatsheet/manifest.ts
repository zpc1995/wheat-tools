import { BranchRegular } from '@fluentui/react-icons';
import type { ToolManifest } from '../types';

export const manifest: ToolManifest = {
  id: 'git-cheatsheet',
  name: 'Git 速查表',
  description:
    '按场景（日常提交、分支、撤销与回退、查看历史、暂存、远程协作、排查问题）组织的 Git 命令速查：每条含一句话说明、使用场景和危险性分级，危险命令还写明怎么用 reflog 之类的手段补救。纯速查，不执行任何命令。',
  tags: ['git', '速查', '版本控制', '命令行'],
  category: 'dev',
  icon: BranchRegular,
  version: '0.1.0',
  translations: {
    'en-US': {
      name: 'Git cheat sheet',
      description:
        'Git commands grouped by task (everyday commits, branches, undoing changes, history, stashing, remotes, troubleshooting). Every entry has a one-line explanation, a use case and an honest danger level, and destructive commands say how to recover with reflog. Reference only: nothing is executed.',
      tags: ['git', 'cheat sheet', 'version control', 'cli'],
    },
  },
};
