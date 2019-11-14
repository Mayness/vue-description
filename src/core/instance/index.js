import { initMixin } from './init'
import { stateMixin } from './state'
import { renderMixin } from './render'
import { eventsMixin } from './events'
import { lifecycleMixin } from './lifecycle'
import { warn } from '../util/index'

function Vue (options) {
  // ES6 可以用 new.target === Vue
  if (process.env.NODE_ENV !== 'production' &&
    !(this instanceof Vue)
  ) {
    warn('Vue is a constructor and should be called with the `new` keyword')
  }
  this._init(options)
}

initMixin(Vue)    // beforeCreate、created处理的任务，主要是初始化数据，事件
stateMixin(Vue)   // 挂载数据检测、检测函数$set、$delete、$watch
eventsMixin(Vue)  // 挂载订阅事件的方法 $on
lifecycleMixin(Vue) // 挂载更新$update、$forceUpdate、$destroy函数
renderMixin(Vue)  // 挂载工具函数、$nextTick、_render生成虚拟dom函数

export default Vue
