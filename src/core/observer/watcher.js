/* @flow */

import {
  warn,
  remove,
  isObject,
  parsePath,
  _Set as Set,
  handleError,
  noop
} from '../util/index'

import { traverse } from './traverse'
import { queueWatcher } from './scheduler'
import Dep, { pushTarget, popTarget } from './dep'

import type { SimpleSet } from '../util/index'

let uid = 0

/**
 * computed、watch、$watch
 * A watcher parses an expression, collects dependencies,
 * and fires callback when the expression value changes.
 * This is used for both the $watch() api and directives.
 */
export default class Watcher {
  vm: Component;  // 当前实例
  expression: string; // 需要观测的对象，用函数进行包裹
  cb: Function; // 触发回调
  id: number;
  deep: boolean;  // 是否开启深度观测
  user: boolean;  // 用户自定义
  lazy: boolean;
  sync: boolean;  // 是否同步执行回调
  dirty: boolean;
  active: boolean;
  deps: Array<Dep>;
  newDeps: Array<Dep>;
  depIds: SimpleSet;
  newDepIds: SimpleSet;
  before: ?Function;  // 触发依赖的前的钩子  在../scheduler.js 中用到
  getter: Function;
  value: any;

  constructor (
    vm: Component,
    expOrFn: string | Function,
    cb: Function,
    options?: ?Object,
    isRenderWatcher?: boolean
  ) {
    this.vm = vm
    if (isRenderWatcher) {  // 是否是渲染函数的watcher
      vm._watcher = this
    }
    vm._watchers.push(this)
    // options
    if (options) {
      this.deep = !!options.deep
      this.user = !!options.user
      this.lazy = !!options.lazy
      this.sync = !!options.sync
      this.before = options.before
    } else {
      this.deep = this.user = this.lazy = this.sync = false
    }
    this.cb = cb
    this.id = ++uid // uid for batching
    this.active = true
    this.dirty = this.lazy // computed中的惰性求值
    this.deps = []  // 上一次收集的依赖
    this.newDeps = [] // 当前新增的依赖
    this.depIds = new Set() // 上一次收集的依赖id Set集合
    this.newDepIds = new Set()  // 当前新增的依赖id Set集合
    this.expression = process.env.NODE_ENV !== 'production'
      ? expOrFn.toString()
      : ''
    // parse expression for getter
    if (typeof expOrFn === 'function') {
      this.getter = expOrFn
    } else {
      this.getter = parsePath(expOrFn)  // 校验格式并转换格式  例如：将 a.b.c 转化为 a[ b[ c ] ] 格式
      if (!this.getter) {
        this.getter = noop
        process.env.NODE_ENV !== 'production' && warn(
          `Failed watching path: "${expOrFn}" ` +
          'Watcher only accepts simple dot-delimited paths. ' +
          'For full control, use a function instead.',
          vm
        )
      }
    }
    this.value = this.lazy  // 若指定惰性求值则在初始化的时候不进行取值操作
      ? undefined
      : this.get()
  }

  /**
   * Evaluate the getter, and re-collect dependencies.
   * 通过get收集依赖
   */
  get () {
    // 这是一个添加过程，为了满足observer 165行 和 Dep 32行 中的 target中取 当前的watcher 的操作 
    pushTarget(this)
    let value
    const vm = this.vm
    try {
      /* 
      *  触发取值操作，此刻往观察者的__ob__中添加的依赖
      *  添加依赖的过程： watcher.get -> Observer.defineReactive.get  -> dep.depend -> watcher.addDep -> dep.addSub
      */
      value = this.getter.call(vm, vm)
    } catch (e) {
      if (this.user) {
        handleError(e, vm, `getter for watcher "${this.expression}"`)
      } else {
        throw e
      }
    } finally {
      // "touch" every property so they are all tracked as
      // dependencies for deep watching
      if (this.deep) {
        traverse(value) // 如果是深度观测，则递归触发内部取值操作
      }
      popTarget() // 将当前watcher从Dep.target推出
      this.cleanupDeps()  // 清空当前记录的依赖id
    }
    return value
  }

  /**
   * Add a dependency to this directive.
   */
  addDep (dep: Dep) {
    const id = dep.id // 这个id是属于Dep中的id，在全局下是唯一的id
    if (!this.newDepIds.has(id)) {  // 防止重复收集依赖，比如数据之间的相互引用 或者 相同的两次get
      this.newDepIds.add(id)
      this.newDeps.push(dep)
      if (!this.depIds.has(id)) {
        dep.addSub(this)  // 再将当前watcher添加到Dep中
      }
    }
  }

  /**
   * Clean up for dependency collection.
   */
  cleanupDeps () {
    let i = this.deps.length
    // 如果原有的dep数组 在 新记录的id没有 则移除该依赖
    while (i--) {
      const dep = this.deps[i]
      if (!this.newDepIds.has(dep.id)) {
        dep.removeSub(this) // 在dep中移除当前watcher, 那么在Dep类中将不再触发当前watcher
      }
    }
    // 主要目的就是 将新记录依赖和依赖id集合 改变为 现有的依赖集合和依赖id集合
    let tmp = this.depIds
    this.depIds = this.newDepIds
    this.newDepIds = tmp
    this.newDepIds.clear()
    tmp = this.deps
    this.deps = this.newDeps
    this.newDeps = tmp
    this.newDeps.length = 0
  }

  /**
   * Subscriber interface.
   * Will be called when a dependency changes.
   * 触发依赖队列
   */
  update () {
    /* istanbul ignore else */
    if (this.lazy) {
      this.dirty = true
    } else if (this.sync) {
      // 如果是同步更新则立即执行当前run方法
      this.run()
    } else {
      // 将当前watcher放入一个异步更新队列
      queueWatcher(this)
    }
  }

  /**
   * Scheduler job interface.
   * Will be called by the scheduler.
   * 执行单个依赖函数
   */
  run () {
    if (this.active) {  // 需要当前watcher是激活状态
      const value = this.get()  // 重新求值，重新挂载watcher的依赖
      if (
        value !== this.value ||
        // Deep watchers and watchers on Object/Arrays should fire even
        // when the value is the same, because the value may
        // have mutated.
        isObject(value) ||  // 如果是对象，需要执行回调
        this.deep // 深度监听，用于watch
      ) {
        // set new value
        const oldValue = this.value
        this.value = value
        if (this.user) {
          try {
            this.cb.call(this.vm, value, oldValue)
          } catch (e) {
            handleError(e, this.vm, `callback for watcher "${this.expression}"`)
          }
        } else {
          this.cb.call(this.vm, value, oldValue)
        }
      }
    }
  }

  /**
   * Evaluate the value of the watcher.
   * This only gets called for lazy watchers.
   */
  evaluate () {
    this.value = this.get()
    this.dirty = false
  }

  /**
   * Depend on all deps collected by this watcher.
   * 将当前所有的依赖项添加进
   */
  depend () {
    let i = this.deps.length
    while (i--) {
      this.deps[i].depend()
    }
  }

  /**
   * Remove self from all dependencies' subscriber list.
   * 移除当前属性上的watcher和依赖
   */
  teardown () {
    if (this.active) {  // 该watcher必须是活跃状态，在初始化的时候就置为true了。
      // remove self from vm's watcher list
      // this is a somewhat expensive operation so we skip it
      // if the vm is being destroyed.
      // 若该组件没有被移除，则还需要移除该watcher。被移除的组件就不需要考虑了，因为已经卸载观察者了，详见 /core/instance/lifecycle.js 112行
      if (!this.vm._isBeingDestroyed) {
        remove(this.vm._watchers, this)
      }
      let i = this.deps.length
      // 并且移除依赖，由于当前watcher已经移除，而依赖函数又是当前watcher，所以同样需要移除
      while (i--) {
        this.deps[i].removeSub(this)
      }
      // 将状态置为false，表示不再监听并触发此watcher
      this.active = false
    }
  }
}
