import { isObject, toTypeString } from '@vue/shared'

import { mutableHandlers, readonlyHandlers } from './baseHandlers'
import {
  mutableCollectionHandlers,
  readonlyCollectionHandlers
} from './collectionHandlers'
import { ReactiveEffect } from './effect'
import { UnwrapRef, Ref } from './ref'
import { makeMap } from '@vue/shared'

// The main WeakMap that stores {target -> key -> dep} connections.
// Conceptually, it's easier to think of a dependency as a Dep class
// which maintains a Set of subscribers, but we simply store them as
// raw Sets to reduce memory overhead.
export type Dep = Set<ReactiveEffect>
export type KeyToDepMap = Map<string | symbol, Dep>
/*
  targetMap = WeakMap{
    targetObject: Set{
      ReactiveEffect      // ReactiveEffect类见 ./effect.ts 中的 ReactiveEffect 接口
    }
  }
*/
export const targetMap = new WeakMap<any, KeyToDepMap>()

// 通过原始数据 查找 响应数据
const rawToReactive = new WeakMap<any, any>()
// 通过响应数据 查找 原始数据
const reactiveToRaw = new WeakMap<any, any>()
const rawToReadonly = new WeakMap<any, any>()
const readonlyToRaw = new WeakMap<any, any>()

// WeakSets for values that are marked readonly or non-reactive during
// observable creation.
const readonlyValues = new WeakSet<any>()
const nonReactiveValues = new WeakSet<any>()

const collectionTypes = new Set<Function>([Set, Map, WeakMap, WeakSet])
const isObservableType = /*#__PURE__*/ makeMap(
  ['Object', 'Array', 'Map', 'Set', 'WeakMap', 'WeakSet']
    .map(t => `[object ${t}]`)
    .join(',')
)

const canObserve = (value: any): boolean => {
  return (
    !value._isVue &&
    !value._isVNode &&
    isObservableType(toTypeString(value)) &&
    !nonReactiveValues.has(value)
  )
}

// only unwrap nested ref
type UnwrapNestedRefs<T> = T extends Ref ? T : UnwrapRef<T>

export function reactive<T extends object>(target: T): UnwrapNestedRefs<T>
export function reactive(target: object) {
  // 如果该对象是个readonly对象，则直接返回该对象
  if (readonlyToRaw.has(target)) {
    return target
  }
  // 对象被 目标标记为可读对象
  if (readonlyValues.has(target)) {
    return readonly(target)
  }
  return createReactiveObject(
    target,
    rawToReactive,
    reactiveToRaw,
    mutableHandlers,
    mutableCollectionHandlers
  )
}

export function readonly<T extends object>(
  target: T
): Readonly<UnwrapNestedRefs<T>> {
  // 该值是个已经是个可变的观察者的话，检查它的原始对象并返回readonly的版本
  if (reactiveToRaw.has(target)) {
    target = reactiveToRaw.get(target)
  }
  return createReactiveObject(
    target,
    rawToReadonly,
    readonlyToRaw,
    readonlyHandlers,
    readonlyCollectionHandlers
  )
}

function createReactiveObject(
  target: any,
  toProxy: WeakMap<any, any>,
  toRaw: WeakMap<any, any>,
  baseHandlers: ProxyHandler<any>,
  collectionHandlers: ProxyHandler<any>
) {
  // 被观测的目标必须是对象，因为proxy只能观测对象
  if (!isObject(target)) {
    if (__DEV__) {
      console.warn(`value cannot be made reactive: ${String(target)}`)
    }
    return target
  }
  // 目标已经是个映射的 响应数据 的原始数据 的话，则直接返回 响应数据
  let observed = toProxy.get(target)
  if (observed !== void 0) {
    return observed
  }
  // 目标如果是个 可响应数据 则直接返回
  if (toRaw.has(target)) {
    return target
  }
  // 只有在白名单的目标才能被监听，白名单包括：
  /* canObserve函数
    1, 不是vue内置数据
    2，不是虚拟dom
    3，'Object', 'Array', 'Map', 'Set', 'WeakMap', 'WeakSet' 中的类型
    4，由nonReactiveValues用户配置的不可监听的值
  */
  if (!canObserve(target)) {
    return target
  }
  // 又对象的构造函数类型来决定proxy到底使用哪种handler，默认是 baseHandlers，如果是集合则用collectionHandlers
  const handlers = collectionTypes.has(target.constructor)
    ? collectionHandlers
    : baseHandlers
  observed = new Proxy(target, handlers)
  // 备份 原始数据 -> 响应数据
  toProxy.set(target, observed)
  // 备份 响应数据 -> 原始数据
  toRaw.set(observed, target)
  if (!targetMap.has(target)) {
    targetMap.set(target, new Map())
  }
  // 返回监听的proxy对象
  return observed
}

export function isReactive(value: any): boolean {
  return reactiveToRaw.has(value) || readonlyToRaw.has(value)
}

export function isReadonly(value: any): boolean {
  return readonlyToRaw.has(value)
}

export function toRaw<T>(observed: T): T {
  return reactiveToRaw.get(observed) || readonlyToRaw.get(observed) || observed
}
// 标记为 仅可读对象
export function markReadonly<T>(value: T): T {
  readonlyValues.add(value)
  return value
}
// 配置决定不能监听的值
export function markNonReactive<T>(value: T): T {
  nonReactiveValues.add(value)
  return value
}
