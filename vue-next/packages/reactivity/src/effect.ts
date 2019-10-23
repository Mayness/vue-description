import { OperationTypes } from './operations'
import { Dep, targetMap } from './reactive'
import { EMPTY_OBJ, extend } from '@vue/shared'

// 为响应函数进行标记
export const effectSymbol = Symbol(__DEV__ ? 'effect' : void 0)

// 封装依赖函数：ReactiveEffect
export interface ReactiveEffect<T = any> {
  (): T
  [effectSymbol]: true
  active: boolean
  raw: () => T
  deps: Array<Dep>
  computed?: boolean
  scheduler?: (run: Function) => void
  onTrack?: (event: DebuggerEvent) => void
  onTrigger?: (event: DebuggerEvent) => void
  onStop?: () => void
}
// 封装依赖函数的一些属性
export interface ReactiveEffectOptions {
  lazy?: boolean
  computed?: boolean
  scheduler?: (run: Function) => void
  onTrack?: (event: DebuggerEvent) => void
  onTrigger?: (event: DebuggerEvent) => void
  onStop?: () => void
}

// 用于调试模式下用到的一些属性
export interface DebuggerEvent {
  effect: ReactiveEffect
  target: any
  type: OperationTypes
  key: string | symbol | undefined
}

// ReactiveEffect堆栈
export const effectStack: ReactiveEffect[] = []

export const ITERATE_KEY = Symbol('iterate')

// 判断函数是否 已经经过createReactiveEffect函数封装
export function isEffect(fn: any): fn is ReactiveEffect {
  return fn != null && fn[effectSymbol] === true
}

export function effect<T = any>(
  fn: () => T,
  options: ReactiveEffectOptions = EMPTY_OBJ
): ReactiveEffect<T> {
 // 检测是否 effect 方法，如果是的话，则取raw上面保存的原始方法
  if (isEffect(fn)) {
    fn = fn.raw
  }
  // 封装响应依赖函数
  const effect = createReactiveEffect(fn, options)
  // 如果不是 惰性 依赖的话，则立刻触发
  if (!options.lazy) {
    effect()
  }
  return effect
}

export function stop(effect: ReactiveEffect) {
  if (effect.active) {
    cleanup(effect)
    if (effect.onStop) {
      effect.onStop()
    }
    effect.active = false
  }
}

// 封装响应依赖函数
function createReactiveEffect<T = any>(
  fn: () => T,
  options: ReactiveEffectOptions
): ReactiveEffect<T> {
  const effect = function reactiveEffect(...args: any[]): any {
    return run(effect, fn, args)
  } as ReactiveEffect
  effect[effectSymbol] = true
  effect.active = true
  effect.raw = fn
  effect.scheduler = options.scheduler
  effect.onTrack = options.onTrack
  effect.onTrigger = options.onTrigger
  effect.onStop = options.onStop
  effect.computed = options.computed
  effect.deps = []
  return effect
}
// TODO:
function run(effect: ReactiveEffect, fn: Function, args: any[]): any {
  // debugger;
  if (!effect.active) {
    return fn(...args)
  }
  if (!effectStack.includes(effect)) {
    cleanup(effect)
    try {
      effectStack.push(effect)
      // 直接return函数的话，就不用catch了
      return fn(...args)
    } finally {
      // 执行完毕都会推出当前依赖函数
      effectStack.pop()
    }
  }
}
// TODO:在所有依赖的对象的响应函数中删除该函数
function cleanup(effect: ReactiveEffect) {
  const { deps } = effect
  if (deps.length) {
    for (let i = 0; i < deps.length; i++) {
      deps[i].delete(effect)
    }
    deps.length = 0
  }
}

let shouldTrack = true

export function pauseTracking() {
  shouldTrack = false
}

export function resumeTracking() {
  shouldTrack = true
}

export function track(
  target: any,
  type: OperationTypes,
  key?: string | symbol
) {
  if (!shouldTrack || effectStack.length === 0) {
    return
  }
  const effect = effectStack[effectStack.length - 1]
  if (type === OperationTypes.ITERATE) {
    key = ITERATE_KEY
  }
  // 取得该目标的依赖Map，在reactive函数中会首先保存该目标，详见 ./reactive.ts中的createReactiveObject函数
  let depsMap = targetMap.get(target)
  // 存储当前对象 值的依赖Map集合
  if (depsMap === void 0) {
    targetMap.set(target, (depsMap = new Map()))
  }
  // 再根据key来取得对应的依赖
  let dep = depsMap.get(key!)
  if (dep === void 0) {
    depsMap.set(key!, (dep = new Set()))
  }
  // 检查是否有重复的 effect
  if (!dep.has(effect)) {
    dep.add(effect)
    // TODO: 该effect又需要推入新的一轮依赖Set集合
    effect.deps.push(dep)
    // 开发环境 需要打点情况下，effect需要进行记录
    if (__DEV__ && effect.onTrack) {
      effect.onTrack({
        effect,
        target,
        type,
        key
      })
    }
  }
}

export function trigger(
  target: any,
  type: OperationTypes,
  key?: string | symbol,
  extraInfo?: any
) {
  const depsMap = targetMap.get(target)
  if (depsMap === void 0) {
    // never been tracked
    return
  }
  const effects = new Set<ReactiveEffect>()
  const computedRunners = new Set<ReactiveEffect>()
  if (type === OperationTypes.CLEAR) {
    // collection being cleared, trigger all effects for target
    depsMap.forEach(dep => {
      addRunners(effects, computedRunners, dep)
    })
  } else {
    // schedule runs for SET | ADD | DELETE
    if (key !== void 0) {
      addRunners(effects, computedRunners, depsMap.get(key))
    }
    // also run for iteration key on ADD | DELETE
    if (type === OperationTypes.ADD || type === OperationTypes.DELETE) {
      const iterationKey = Array.isArray(target) ? 'length' : ITERATE_KEY
      addRunners(effects, computedRunners, depsMap.get(iterationKey))
    }
  }
  const run = (effect: ReactiveEffect) => {
    scheduleRun(effect, target, type, key, extraInfo)
  }
  // Important: computed effects must be run first so that computed getters
  // can be invalidated before any normal effects that depend on them are run.
  computedRunners.forEach(run)
  effects.forEach(run)
}

function addRunners(
  effects: Set<ReactiveEffect>,
  computedRunners: Set<ReactiveEffect>,
  effectsToAdd: Set<ReactiveEffect> | undefined
) {
  if (effectsToAdd !== void 0) {
    effectsToAdd.forEach(effect => {
      if (effect.computed) {
        computedRunners.add(effect)
      } else {
        effects.add(effect)
      }
    })
  }
}

function scheduleRun(
  effect: ReactiveEffect,
  target: any,
  type: OperationTypes,
  key: string | symbol | undefined,
  extraInfo: any
) {
  if (__DEV__ && effect.onTrigger) {
    effect.onTrigger(
      extend(
        {
          effect,
          target,
          key,
          type
        },
        extraInfo
      )
    )
  }
  if (effect.scheduler !== void 0) {
    effect.scheduler(effect)
  } else {
    effect()
  }
}
