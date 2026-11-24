import type { VRMExpressionManager } from '@pixiv/three-vrm'

export function motionFaceTargets(id: string, seconds: number, speechLevel = 0) {
  const blinkPhase = ((seconds % 4.7) + 4.7) % 4.7
  const blink = Math.max(0, 1 - Math.abs(blinkPhase - .12) / .12)
  const sleeping = id === 'cloud_standby_sleep'
  const humming = id === 'cloud_standby_sing'
  const voice = Number.isFinite(speechLevel) ? Math.min(.7, Math.max(0, speechLevel)) : 0
  const rhythm = .5 + .5 * Math.sin(seconds * Math.PI * 2 * 1.25)
  const hum = humming && voice < .01 ? .2 + .18 * rhythm : 0
  return {
    blink: sleeping ? .98 : Math.max(blink, humming ? .2 + .15 * rhythm : id === 'cloud_emotion_tired' ? .45 : 0),
    aa: voice > .01 ? voice * .8 : hum * .45,
    oh: voice > .01 ? voice * .2 : hum * .65,
  }
}

/** One owner for eyelids and mouth, so the normal blink cannot reopen sleep. */
export class AvatarFaceAnimation {
  private blink = 0
  private aa = 0
  private oh = 0
  update(manager: VRMExpressionManager, id: string, seconds: number, delta: number, speechLevel = 0) {
    const target = motionFaceTargets(id, seconds, speechLevel)
    const blend = 1 - Math.exp(-Math.max(0, delta) / .07)
    this.blink += (target.blink - this.blink) * blend
    this.aa += (target.aa - this.aa) * blend
    this.oh += (target.oh - this.oh) * blend
    const bilateral = !!manager.getExpression('blink')
    for (const name of ['blink', 'blinkLeft', 'blinkRight']) {
      if (manager.getExpression(name)) manager.setValue(name, bilateral ? name === 'blink' ? this.blink : 0 : this.blink)
    }
    manager.setValue('aa', this.aa)
    manager.setValue('oh', this.oh)
  }
}
