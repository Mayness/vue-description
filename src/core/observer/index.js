/* @flow */

import Dep from './dep'
import VNode from '../vdom/vnode'
import { arrayMethods } from './array'
import {
  def,
  warn,
  hasOwn,
  hasProto,
  isObject,
  isPlainObject,
  isPrimitive,
  isUndef,
  isValidArrayIndex,
  isServerRendering
} from '../util/index'

const arrayKeys = Object.getOwnPropertyNames(arrayMethods)  // 重写数组原型，采用数组变异方法。

/**
 * In some cases we may want to disable observation inside a component's
 * update computation.
 */
export let shouldObserve: boolean = true

export function toggleObserving (value: boolean) {
  shouldObserve = value
}

/**
 * Observer class that is attached to each observed
 * object. Once attached, the observer converts the target
 * object's property keys into getter/setters that
 * collect dependencies and dispatch updates.
 */
export class Observer { // 观测者
  value: any;
  dep: Dep;
  vmCount: number; // number of vms that have this object as root $data

  constructor (value: any) {
    this.value = value
    this.dep = new Dep()  // 新建一个订阅者
    this.vmCount = 0
    def(value, '__ob__', this)  // 初始化观测值
    if (Array.isArray(value)) { // 数组的观测方法
      if (hasProto) { // 判断是否支持__proto__
        protoAugment(value, arrayMethods) // 如果支持则通过__proto__将变异数组进行挂载
      } else {
        copyAugment(value, arrayMethods, arrayKeys) // 不支持则通过defineProperty进行重写
      }
      this.observeArray(value)  // 调用观测者上面的挂载数组的方法 ( 其实如果数组中的数据是基本类型的话则不用在进行观测，如果是对象则进行深度观测 )
    } else {
      this.walk(value)
    }
  }

  /**
   * Walk through all properties and convert them into
   * getter/setters. This method should only be called when
   * value type is Object.
   */
  walk (obj: Object) {
    const keys = Object.keys(obj)
    for (let i = 0; i < keys.length; i++) {
      defineReactive(obj, keys[i])  // NOTE: 这里没有传递第三个参数, 主要是避免触发在computed中的get函数，因为computed属于惰性求值
    }
  }

  /**
   * Observe a list of Array items.
   */
  observeArray (items: Array<any>) {
    for (let i = 0, l = items.length; i < l; i++) {
      observe(items[i])
    }
  }
}

// helpers

/**
 * Augment a target Object or Array by intercepting
 * the prototype chain using __proto__
 */
function protoAugment (target, src: Object) {
  /* eslint-disable no-proto */
  target.__proto__ = src
  /* eslint-enable no-proto */
}

/**
 * Augment a target Object or Array by defining
 * hidden properties.
 */
/* istanbul ignore next */
function copyAugment (target: Object, src: Object, keys: Array<string>) {
  for (let i = 0, l = keys.length; i < l; i++) {
    const key = keys[i]
    def(target, key, src[key])
  }
}

/**
 * Attempt to create an observer instance for a value,
 * returns the new observer if successfully observed,
 * or the existing observer if the value already has one.
 */
export function observe (value: any, asRootData: ?boolean): Observer | void {
  if (!isObject(value) || value instanceof VNode) {
    return
  }
  let ob: Observer | void
  if (hasOwn(value, '__ob__') && value.__ob__ instanceof Observer) {
    // 查看是否已经是observer，则直接返回
    ob = value.__ob__
  } else if ( // 1,需要开启观测 2，非服务端渲染 3，需要是数组或一般对象 4，可扩展的对象 5，需要是vue上的数据
    shouldObserve &&
    !isServerRendering() &&
    (Array.isArray(value) || isPlainObject(value)) &&
    Object.isExtensible(value) &&
    !value._isVue
  ) {
    ob = new Observer(value)  // 在这里面会将observer 放入 ob.__ob__
  }
  if (asRootData && ob) {
    ob.vmCount++
  }
  return ob
}

/**
 * Define a reactive property on an Object.
 * 为对象赋予get和set，并且执行 更新依赖 和 触发依赖
 */
export function defineReactive (
  obj: Object,  // 需要赋予get和set的对象
  key: string,  // 键
  val: any, // 值
  customSetter?: ?Function, // set执行前的钩子，只有在开发环境有效，用来内部测试或抛出warn
  shallow?: boolean //  是否关闭深度观测，这里响应数据默认是开启的（false）,只有$attrs和$listener是关闭的（true）
) {
  const dep = new Dep()

  const property = Object.getOwnPropertyDescriptor(obj, key)  // 获得vue中的属性描述
  if (property && property.configurable === false) {  // 如果该属性不可配置则直接return，如Object.freeze等即不可扩展
    return
  }

  // cater for pre-defined getter/setters
  // 对属性描述的get和set进行存储，方便下面执行的重写操作
  const getter = property && property.get
  const setter = property && property.set
  // 在walk中触发的defineReactive函数中，都没有传递val参数，是因为避免触发内部定义的get函数。因此当内部不存在get函数 并且 存在set，才会进行取值。这是为了保证数据的一致性
  if ((!getter || setter) && arguments.length === 2) {  
    val = obj[key]
  }
  let childOb = !shallow && observe(val)  // observe 只观测对象，如果是基础类型则不做处理，这里默认是采用深度观测。
  Object.defineProperty(obj, key, {
    enumerable: true,
    configurable: true,
    get: function reactiveGetter () {
      const value = getter ? getter.call(obj) : val
      if (Dep.target) { // 当前watcher类
        dep.depend()  // 添加到当前对象的依赖
        if (childOb) {
          childOb.dep.depend()  // 同时给子节点也添加依赖
          if (Array.isArray(value)) {
            dependArray(value)  // 如果值是数组，则给数组内部的对象中的__ob__添加依赖
          }
        }
      }
      return value
    },
    set: function reactiveSetter (newVal) {
      const value = getter ? getter.call(obj) : val
      /* eslint-disable no-self-compare */
      if (newVal === value || (newVal !== newVal && value !== value)) { // 如果值未改变 或 新值和旧值都是NaN 则不触发值更新
        return
      }
      /* eslint-enable no-self-compare */
      if (process.env.NODE_ENV !== 'production' && customSetter) {
        customSetter()  // Vue内部的钩子操作
      }
      // #7981: for accessor properties without setter
      if (getter && !setter) return // 如果computed内部中没有setter，直接return，当可读属性处理
      if (setter) {
        setter.call(obj, newVal)
      } else {
        val = newVal
      }
      childOb = !shallow && observe(newVal) // 更新值的观测，即对新值进行重新观测
      dep.notify()  // 触发依赖  
    }
  })
}

/**
 * Set a property on an object. Adds the new property and
 * triggers change notification if the property doesn't
 * already exist.
 * 在数据中添加之前未定义的相应数据
 */
export function set (target: Array<any> | Object, key: any, val: any): any {
  if (process.env.NODE_ENV !== 'production' &&
    (isUndef(target) || isPrimitive(target))  // 判断是undefined、null、原始类型
  ) {
    warn(`Cannot set reactive property on undefined, null, or primitive value: ${(target: any)}`)
  }
  if (Array.isArray(target) && isValidArrayIndex(key)) {  // 对数组的判断，判断是否是有效 下标
    // 这里为了防止key大于数组下标后，val仅添加到最后一个。因此需要先设置长度，再通过splice改变数组。
    /* TEST:
        const a = [ 1, 2, 3 ];
        a.splice(5, 1, 'res');  // [ 1, 2, 3, 'res' ]

        const b = [ 1, 2, 3 ];
        b.length = 5;
        b.splice(5, 1, 'res'); // [1, 2, 3, empty × 2, 'res' ] 
    */
    target.length = Math.max(target.length, key)
    target.splice(key, 1, val)
    return val
  }
  // 如果这个key在对象上 并且 这个key不能属于Object原型链上的属性。 因此对象上的属性会被观测。
  /* TEST:
    class Bar {
      constructor() {
        this.test = '123'
      }
      get fol() {
        return 'fol';
      }
    }
    new Vue({
      data() {
        return {
          bar: new Bar(),   // bar上的test属性, fol方法 都会被观测。 如果用hasOwnProperty 的话则无法监测fol
        }
      }
    })
  */
  if (key in target && !(key in Object.prototype)) {  // https://github.com/vuejs/vue/issues/6845
    target[key] = val // 直接设置值并且返回即可，无需再进行观测
    return val
  }
  const ob = (target: any).__ob__
  if (target._isVue || (ob && ob.vmCount)) {  // 如果该对象属于vue实例则不允许被观测   { bar: new Vue() } 不允许 ； 这里ob.vmCount 若有值则代表是是根元素，不允许观测data
    process.env.NODE_ENV !== 'production' && warn(
      'Avoid adding reactive properties to a Vue instance or its root $data ' +
      'at runtime - declare it upfront in the data option.'
    )
    return val
  }
  if (!ob) {  // 如果target原本就是非响应的，则不再进行观测
    target[key] = val
    return val
  }
  defineReactive(ob.value, key, val)  // 为观测的target新增键的get和set
  ob.dep.notify() // 触发依赖
  return val
}

/**
 * Delete a property and trigger change if necessary.
 */
export function del (target: Array<any> | Object, key: any) {
  if (process.env.NODE_ENV !== 'production' &&
    (isUndef(target) || isPrimitive(target))
  ) {
    warn(`Cannot delete reactive property on undefined, null, or primitive value: ${(target: any)}`)
  }
  if (Array.isArray(target) && isValidArrayIndex(key)) {
    target.splice(key, 1)
    return
  }
  const ob = (target: any).__ob__
  if (target._isVue || (ob && ob.vmCount)) {
    process.env.NODE_ENV !== 'production' && warn(
      'Avoid deleting properties on a Vue instance or its root $data ' +
      '- just set it to null.'
    )
    return
  }
  if (!hasOwn(target, key)) { // 若prototype和属性上面都不存在则直接返回
    return
  }
  delete target[key]
  if (!ob) {
    return
  }
  ob.dep.notify()
}

/**
 * Collect dependencies on array elements when the array is touched, since
 * we cannot intercept array element access like property getters.
 */
function dependArray (value: Array<any>) {
  for (let e, i = 0, l = value.length; i < l; i++) {
    e = value[i]
    e && e.__ob__ && e.__ob__.dep.depend()
    if (Array.isArray(e)) {
      dependArray(e)
    }
  }
}
