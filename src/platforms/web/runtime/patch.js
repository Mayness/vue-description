/* @flow */

import * as nodeOps from 'web/runtime/node-ops'
import { createPatchFunction } from 'core/vdom/patch'
import baseModules from 'core/vdom/modules/index'
import platformModules from 'web/runtime/modules/index'

// the directive module should be applied last, after all
// built-in modules have been applied.
// 对于directive模块需要等其他模块加载完再加载
// 对于平台化的模块做一些处理
const modules = platformModules.concat(baseModules)
// 高阶函数：对于patch做平台化的预解析
export const patch: Function = createPatchFunction({ nodeOps, modules })
