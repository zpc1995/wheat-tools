import { MathFormulaRegular } from '@fluentui/react-icons';
import type { ToolManifest } from '../types';

export const manifest: ToolManifest = {
  id: 'math-evaluator',
  name: '数学表达式计算器',
  description:
    '实时求值数学表达式：自带词法分析与语法分析，绝不使用 eval。运算符优先级与结合性正确（-2^2 = -4、2^3^2 = 512），支持阶乘、常用函数与常量、角度/弧度切换、小数位数与千分位，并展示计算过程与 RPN。不做符号求导积分、方程求解与单位换算。',
  tags: ['数学表达式', '计算器', '运算符优先级', 'RPN'],
  category: 'dev',
  icon: MathFormulaRegular,
  version: '0.1.0',
  translations: {
    'en-US': {
      name: 'Math expression evaluator',
      description:
        'Evaluates math expressions as you type with a hand-written lexer and parser — no eval, ever. Correct precedence and associativity (-2^2 is -4, 2^3^2 is 512), factorial, the usual functions and constants, degrees or radians, decimal places and thousands separators, plus a step-by-step trace and the RPN form. No symbolic calculus, no equation solving, no unit conversion.',
      tags: ['math expression', 'calculator', 'precedence', 'RPN'],
    },
  },
};
