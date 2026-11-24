// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import ConfigPicker from './ConfigPicker.vue'
const options = [{ value:'Cherry',label:'芊悦',group:'预置'}, {value:'Serena',label:'苏瑶',group:'预置'}, {value:'Kiki',label:'阿清',group:'方言'}]
describe('configuration picker', () => {
  it('arrow always opens every option independent of existing input, typing filters', async () => {
    const wrapper = mount(ConfigPicker,{props:{modelValue:'Cherry',options,editable:true,label:'音色 ID'}})
    await wrapper.get('.picker-arrow').trigger('click')
    expect(wrapper.findAll('[role=option]')).toHaveLength(3)
    await wrapper.get('input').setValue('Ser')
    expect(wrapper.findAll('[role=option]')).toHaveLength(1)
    expect(wrapper.get('[role=option]').text()).toContain('Serena')
    await wrapper.get('.picker-arrow').trigger('click'); await wrapper.get('.picker-arrow').trigger('click')
    expect(wrapper.findAll('[role=option]')).toHaveLength(3)
    await wrapper.findAll('[role=option]')[2]!.trigger('click')
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual(['Kiki']); wrapper.unmount()
  })
  it('groups motion options and supports keyboard selection without a native select', async () => {
    const wrapper = mount(ConfigPicker,{props:{modelValue:'Cherry',options,label:'动作库'}})
    await wrapper.get('.picker-value').trigger('click')
    expect(wrapper.findAll('.picker-group')).toHaveLength(2)
    await wrapper.trigger('keydown',{key:'ArrowDown'}); await wrapper.trigger('keydown',{key:'Enter'})
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual(['Serena']); wrapper.unmount()
  })
  it('opens upward when the settings control is near the bottom of the viewport', async () => {
    const wrapper = mount(ConfigPicker,{props:{modelValue:'Cherry',options,label:'动作库'}})
    vi.spyOn(wrapper.element,'getBoundingClientRect').mockReturnValue({top:700,bottom:740,left:0,right:200,width:200,height:40,x:0,y:700,toJSON:()=>({})})
    await wrapper.get('.picker-value').trigger('click')
    await wrapper.vm.$nextTick()
    expect(wrapper.classes()).toContain('picker-up')
    expect(wrapper.get('.picker-menu').attributes('style')).toContain('max-height: 250px')
    wrapper.unmount()
  })
  it('shows only the chosen motion category inside a shared dropdown', async () => {
    const wrapper = mount(ConfigPicker,{props:{modelValue:'gesture:idle',options:[{value:'emotion:neutral',label:'正常回答',group:'回答动作'},{value:'gesture:idle',label:'自然待机',group:'常用动作'},{value:'gesture:thinking_loop',label:'思考',group:'常用动作'}],groupTabs:true,label:'动作库'}})
    await wrapper.get('.picker-value').trigger('click')
    expect(wrapper.findAll('[role=tab]')).toHaveLength(2)
    expect(wrapper.findAll('[role=option]')).toHaveLength(2)
    expect(wrapper.find('[role=option]').text()).toContain('自然待机')
    await wrapper.findAll('[role=tab]')[0]!.trigger('click')
    expect(wrapper.findAll('[role=option]')).toHaveLength(1)
    expect(wrapper.get('[role=option]').text()).toContain('正常回答')
    wrapper.unmount()
  })
  it('does not open a disabled settings selector', async () => {
    const wrapper = mount(ConfigPicker,{props:{options,label:'动作模式',disabled:true}})
    await wrapper.get('.picker-value').trigger('click')
    expect(wrapper.find('.picker-menu').exists()).toBe(false)
    expect(wrapper.get('.picker-arrow').attributes('disabled')).toBeDefined()
    wrapper.unmount()
  })
})
