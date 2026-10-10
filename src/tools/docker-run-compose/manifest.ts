import { CubeMultipleRegular } from '@fluentui/react-icons';
import type { ToolManifest } from '../types';

export const manifest: ToolManifest = {
  id: 'docker-run-compose',
  name: 'Docker Run 转 Compose',
  description:
    '把 docker run 命令改写成 docker-compose.yml。识别 -p/-v/-e/--env-file/--name/--restart/--network/--hostname/--entrypoint/-w/-u/--privileged/--cap-add/--memory/--cpus/--label/--health-cmd 等常用选项，支持引号参数、--flag=值 与 -p8080:80 三种写法，并正确分离末尾的镜像与 command。不连 Docker daemon、不校验镜像是否存在。',
  tags: ['docker', 'compose', '容器', 'yaml', '命令行'],
  category: 'dev',
  icon: CubeMultipleRegular,
  version: '0.1.0',
  translations: {
    'en-US': {
      name: 'Docker run to Compose',
      description:
        'Turn a docker run command into a docker-compose.yml. Handles -p/-v/-e/--env-file/--name/--restart/--network/--hostname/--entrypoint/-w/-u/--privileged/--cap-add/--memory/--cpus/--label/--health-cmd and more, accepts quoted arguments plus both --flag=value and -p8080:80 spellings, and separates the trailing image from the command correctly. It never talks to the Docker daemon and never checks whether the image exists.',
      tags: ['docker', 'compose', 'container', 'yaml', 'cli'],
    },
  },
};
