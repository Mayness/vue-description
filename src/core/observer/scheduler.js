/* @flow */

import type Watcher from './watcher'
import config from '../config'
import { callHook, activateChildComponent } from '../instance/lifecycle'

import {
  warn,
  nextTick,
  devtools,
  inBrowser,
  isIE
} from '../util/index'

export const MAX_UPDATE_COUNT = 100

// 全局异步更新队列
const queue: Array<Watcher> = []
const activatedChildren: Array<Component> = []
// 记录所有watcher的id
let has: { [key: number]: ?true } = {}
let circular: { [key: number]: number } = {}
let waiting = false
let flushing = false
let index = 0

/**
 * Reset the scheduler's state.
 */
function resetSchedulerState () {
  index = queue.length = activatedChildren.length = 0
  has = {}
  if (process.env.NODE_ENV !== 'production') {
    circular = {}
  }
  waiting = flushing = false
}

// Async edge case #6566 requires saving the timestamp when event listeners are
// attached. However, calling performance.now() has a perf overhead especially
// if the page has thousands of event listeners. Instead, we take a timestamp
// every time the scheduler flushes and use that for all event listeners
// attached during that flush.
export let currentFlushTimestamp = 0

// Async edge case fix requires storing an event listener's attach timestamp.
let getNow: () => number = Date.now

// Determine what event timestamp the browser is using. Annoyingly, the
// timestamp can either be hi-res (relative to page load) or low-res
// (relative to UNIX epoch), so in order to compare time we have to use the
// same timestamp type when saving the flush timestamp.
// All IE versions use low-res event timestamps, and have problematic clock
// implementations (#9632)
if (inBrowser && !isIE) {
  const performance = window.performance
  if (
    performance &&
    typeof performance.now === 'function' &&
    getNow() > document.createEvent('Event').timeStamp
  ) {
    // if the event timestamp, although evaluated AFTER the Date.now(), is
    // smaller than it, it means the event is using a hi-res timestamp,
    // and we need to use the hi-res version for event listener timestamps as
    // well.
    getNow = () => performance.now()
  }
}

/**
 * Flush both queues and run the watchers.
 * 执行watcher队列
 */
function flushSchedulerQueue () {
  currentFlushTimestamp = getNow()
  flushing = true // 状态置为更新中
  let watcher, id

  // Sort queue before flush.
  // This ensures that:
  // 1. Components are updated from parent to child. (because parent is always
  //    created before the child)
  // 2. A component's user watchers are run before its render watcher (because
  //    user watchers are created before the render watcher)
  // 3. If a component is destroyed during a parent component's watcher run,
  //    its watchers can be skipped.
  /*  这里为什么需要在更新队列之前排序？
        1,组件更新顺序必须是 父组件 -> 子组件 的顺序 （因为父组件比子组件先渲染出来）
        2,因为用户自定义的watcher比渲染函数的watcher 要先创建    （不理解)
        3,如果一个组件在父组件watcher触发的时候被摧毁，那么这个watcher队列应该被跳过
  */
  queue.sort((a, b) => a.id - b.id)

  // do not cache length because more watchers might be pushed
  // as we run existing watchers
  // 不要缓存此刻的队列长度，因为有许多watcher会在运行期间插入进来（ 例如computed依赖的渲染函数 ）
  for (index = 0; index < queue.length; index++) {
    watcher = queue[index]
    if (watcher.before) { // 定义的前置钩子
      watcher.before()
    }
    id = watcher.id
    has[id] = null  // 将当前执行watcher的id 从 has对象中释放
    watcher.run() // 触发当前watcher的执行函数
    // in dev build, check and stop circular updates.
    // 此期间可能有新的watcher加入，例如用户定义的递归渲染函数依赖。如果依赖的递归渲染函数调用层数超过 MAX_UPDATE_COUNT 的限制，则会抛出警告
    if (process.env.NODE_ENV !== 'production' && has[id] != null) {
      circular[id] = (circular[id] || 0) + 1
      if (circular[id] > MAX_UPDATE_COUNT) {
        warn(
          'You may have an infinite update loop ' + (
            watcher.user
              ? `in watcher with expression "${watcher.expression}"`
              : `in a component render function.`
          ),
          watcher.vm
        )
        break
      }
    }
  }

  // keep copies of post queues before resetting state
  // 备份当前队列
  const activatedQueue = activatedChildren.slice()
  const updatedQueue = queue.slice()
  
  // 重置 当前状态
  // waiting = flushing = false
  resetSchedulerState()

  // call component updated and activated hooks
  // 触发钩子， updated, activated
  callActivatedHooks(activatedQueue)
  callUpdatedHooks(updatedQueue)

  // devtool hook
  /* istanbul ignore if */
  if (devtools && config.devtools) {
    devtools.emit('flush')
  }
}

function callUpdatedHooks (queue) {
  let i = queue.length
  while (i--) {
    const watcher = queue[i]
    const vm = watcher.vm
    if (vm._watcher === watcher && vm._isMounted && !vm._isDestroyed) {
      callHook(vm, 'updated')
    }
  }
}

/**
 * Queue a kept-alive component that was activated during patch.
 * The queue will be processed after the entire tree has been patched.
 */
export function queueActivatedComponent (vm: Component) {
  // setting _inactive to false here so that a render function can
  // rely on checking whether it's in an inactive tree (e.g. router-view)
  vm._inactive = false
  activatedChildren.push(vm)
}

function callActivatedHooks (queue) {
  for (let i = 0; i < queue.length; i++) {
    queue[i]._inactive = true
    activateChildComponent(queue[i], true /* true */)
  }
}

/**
 * Push a watcher into the watcher queue.
 * Jobs with duplicate IDs will be skipped unless it's
 * pushed when the queue is being flushed.
 * 添加一个watcher到当前 watcher执行队列
 * 按照ID重复的的watcher会被跳过，除非队列刷新的时候被添加
 */
export function queueWatcher (watcher: Watcher) {
  const id = watcher.id
  if (has[id] == null) {  // 这里是==，因此这里是为了过滤重复的id
    has[id] = true
    if (!flushing) {  // flushing 为当前更新状态    true 正在更新   false 还在收集状态，并未更新
      queue.push(watcher) // 直接添加进队列
    } else {  // 这里是当正在更新的时候，插入队列。 典型的如computed：普通依赖 -> 计算属性依赖（通常是渲染函数），这个时候就需要一同更新 
      // if already flushing, splice the watcher based on its id
      // if already past its id, it will be run next immediately.
      let i = queue.length - 1
      while (i > index && queue[i].id > watcher.id) {
        i--
      }
      queue.splice(i + 1, 0, watcher)
    }
    // queue the flush
    if (!waiting) { // 这里做了节流处理，当flushSchedulerQueue函数执行完毕会将waiting置为false
      waiting = true

      // 全局同步处理，Vue.config.async 属性设置。 一般是开发环境做测试用。
      if (process.env.NODE_ENV !== 'production' && !config.async) {
        flushSchedulerQueue()
        return
      }
      nextTick(flushSchedulerQueue) // 将队列 放到 异步环境下
    }
  }
}
