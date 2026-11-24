<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { isTauri } from './tauri'
import { vHighlightSearch } from './guideSearch'

const active = ref('start')
const search = ref('')
const content = ref<HTMLElement>()
const sectionText = ref<Record<string, string>>({})
const linkFeedback = ref('')
const sections = [
  { id: 'start', title: '首次使用与主页', terms: '导入 模型 角色 应用 改名 删除 预览' },
  { id: 'interaction', title: '交互与控制', terms: '置顶 气泡 待机 点击 视线 追踪 鼠标' },
  { id: 'settings', title: '配置填写与保存', terms: 'API 密钥 地址 模型 检测 保存 生效' },
  { id: 'persona', title: '人设', terms: '模板 文档 导入 导出 Embedding BGE' },
  { id: 'memory', title: '记忆', terms: 'MemU Markdown 迁移 路径 Embedding BGE' },
  { id: 'brain', title: '大脑', terms: 'DeepSeek 火山 方舟 大语言模型 对话 LLM' },
  { id: 'tools', title: '手脚', terms: 'MCP JSON 服务 工具 列表 启用 禁用 导入 导出' },
  { id: 'vision', title: '视觉', terms: '摄像头 人脸 检测 BlazeFace 设备' },
  { id: 'hearing', title: '听觉', terms: '语音识别 ASR SenseVoice 百炼 麦克风' },
  { id: 'voice', title: '语音', terms: '语音合成 TTS 音色 百炼 声音 播报' },
  { id: 'motion', title: '动作', terms: '动作库 在线 离线 混合 时长 腾讯 HY-Motion' },
  { id: 'call', title: '聊天与通话', terms: '电话 附件 历史 会话 共享 打断 静音' },
  { id: 'local', title: '文件与代码操作', terms: '本地 批准 策略 沙盒 工作空间 权限 文件 代码 命令' },
  { id: 'data', title: '数据与隐私', terms: '存储 备份 密钥 上传 删除 角色 隔离' },
  { id: 'help', title: '故障排查', terms: '异常 错误 连接 停用 无法 超时 401 403 404 429' },
]
const visibleSections = computed(() => {
  const words = search.value.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)
  return sections.filter(section => words.every(word =>
    `${section.title} ${section.terms} ${sectionText.value[section.id] || ''}`.toLocaleLowerCase().includes(word),
  ))
})
const visibleIds = computed(() => new Set(visibleSections.value.map(item => item.id)))
const links = {
  keys: 'https://help.aliyun.com/zh/model-studio/get-api-key',
  bailian: 'https://bailian.console.aliyun.com/',
  embedding: 'https://help.aliyun.com/zh/model-studio/text-embedding-synchronous-api',
  deepseek: 'https://platform.deepseek.com/',
  deepseekDocs: 'https://api-docs.deepseek.com/zh-cn/',
  ark: 'https://console.volcengine.com/ark/',
  asr: 'https://help.aliyun.com/zh/model-studio/qwen-asr-api-reference',
  tts: 'https://help.aliyun.com/zh/model-studio/qwen-tts-api',
  mcp: 'https://github.com/modelcontextprotocol/servers',
  face: 'https://ai.google.dev/edge/mediapipe/solutions/vision/face_detector/web_js',
  motion: 'https://hunyuan.tencent.com/motion',
  tencent: 'https://console.cloud.tencent.com/hunyuan',
}
const mcpExample = JSON.stringify({
  mcpServers: {
    '我的远程服务': { url: 'https://YOUR-SERVER/mcp', headers: { Authorization: 'Bearer YOUR_TOKEN' } },
    '我的本地服务': { command: 'YOUR_EXECUTABLE', args: [], env: {} },
  },
}, null, 2)

function jump(id: string) {
  active.value = id
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}
function updateActive() {
  if (!content.value) return
  const boundary = content.value.getBoundingClientRect().top + 110
  let current = visibleSections.value[0]?.id
  for (const section of visibleSections.value) {
    const element = document.getElementById(section.id)
    if (element && element.getBoundingClientRect().top <= boundary) current = section.id
  }
  if (current) active.value = current
}
async function openReference(event: MouseEvent, url: string) {
  if (!isTauri()) return
  event.preventDefault()
  linkFeedback.value = ''
  try {
    await invoke('run_system_action', { actionType: 'open_url', param: url })
  } catch {
    linkFeedback.value = '未能打开浏览器，请检查系统的默认浏览器设置后重试。'
  }
}
watch(search, async () => {
  await nextTick()
  active.value = visibleSections.value[0]?.id || ''
  content.value?.scrollTo?.({ top: 0 })
})
onMounted(() => {
  sectionText.value = Object.fromEntries(sections.map(section => [
    section.id, document.getElementById(section.id)?.textContent || '',
  ]))
})
</script>

<template>
  <main class="tutorial guide-layout">
    <aside class="guide-sidebar">
      <div class="guide-brand"><span>DESKAURA GUIDE</span><h1>使用指南</h1></div>
      <label class="guide-search"><span class="guide-sr-only">搜索使用指南</span><input v-model="search" type="search" placeholder="搜索字段、按钮或问题" aria-label="搜索使用指南" /></label>
      <nav aria-label="使用指南目录">
        <button v-for="item in visibleSections" :key="item.id" type="button" :class="{ active: active === item.id }" :aria-current="active === item.id ? 'location' : undefined" @click="jump(item.id)">
          <small>{{ String(sections.findIndex(section => section.id === item.id) + 1).padStart(2, '0') }}</small><span v-highlight-search="search">{{ item.title }}</span>
        </button>
      </nav>
      <p class="guide-side-note">按角色独立设置<br />资料核对：2026-11-09</p>
    </aside>

    <div ref="content" v-highlight-search="search" class="guide-content" @scroll.passive="updateActive">
      <header v-show="!search.trim()" class="guide-intro">
        <span class="guide-kicker">从第一次启动开始</span>
        <h2>DeskAura 使用指南</h2>
        <p>先让角色出现在桌面并能正常对话，再按需要开启语音、记忆和工具。没有配置的功能可以先关闭。</p>
        <ol class="guide-route" aria-label="首次使用顺序"><li><b>1</b><span>导入并应用角色</span></li><li><b>2</b><span>配置大脑并检测</span></li><li><b>3</b><span>开启需要的模块</span></li><li><b>4</b><span>聊天或开始通话</span></li></ol>
        <p class="guide-intro-note">云端服务通常需要单独注册、开通模型和支付费用。填写密钥不等于充值，软件不会替你开通服务或保证免费额度。</p>
      </header>
      <p v-if="search.trim()" class="guide-search-summary" role="status">找到 {{ visibleSections.length }} 个相关章节<span v-if="!visibleSections.length">，试试「API」「麦克风」「权限」等关键词。</span></p>
      <p v-if="linkFeedback" class="guide-warning" role="alert">{{ linkFeedback }}</p>

      <section v-show="visibleIds.has('start')" id="start">
        <span class="guide-kicker">01 · 开始使用</span><h2>首次使用与主页</h2>
        <h3>第一次打开，照着这四步做</h3>
        <ol>
          <li>点击主页左侧「导入模型」，选择可信的模型文件，也可以将文件拖入主页。推荐先用带标准人形骨骼的 <code>.vrm</code> 模型。</li>
          <li>在「我的角色」中单击名称检查预览。单击只改变预览，不会把正在桌面运行的角色换掉；点击预览上方的「应用」，才会切换桌面角色。</li>
          <li>在主页右侧「角色模块」中开启「大脑」，点击该模块进入设置。填好 API 地址、模型和密钥，保存后检测。</li>
          <li>双击桌面角色打开对话框，先发一句普通文字。确认能回复后，再配置听觉、语音、工具等模块，便于定位问题。</li>
        </ol>
        <div class="guide-table-wrap"><table><thead><tr><th>主页项目</th><th>用途与注意事项</th></tr></thead><tbody>
          <tr><td>内置模型 / 恢复内置模型</td><td>系统默认内置「结海 (Yuika)」与「千駄ヶ谷渋 (Shibu)」两款精选 VRM 模型，开箱即用支持眼球追踪与口型；若误删可通过「恢复内置模型」一键找回。内置模型许可遵循原作者开源协议（结海：minto_akayama / VRoid Hub；千駄ヶ谷渋：VRoidプロジェクト）。</td></tr>
          <tr><td>导入模型</td><td>支持 VRM、FBX、GLB、GLTF；Blend、Maya 文件需要本机已安装相应转换软件。能显示外观不代表骨骼、口型、眼动全部兼容。</td></tr>
          <tr><td>我的角色 / 名称</td><td>每条记录是一个独立角色。同一模型可重复导入，用来建立不同人设与配置；重名时自动加序号。主页描述最多显示两行，超出省略，不改变模型预览区大小。</td></tr>
          <tr><td>铅笔 / 右键名称</td><td>修改角色名称。回车或移开焦点保存，Esc 取消；不改动原始模型文件名。</td></tr>
          <tr><td>移除 ×</td><td>确认后删除该角色配置、会话与记忆；原始模型文件保留。此操作不能撤销，先备份重要数据。</td></tr>
          <tr><td>应用 / 取消应用</td><td>将预览角色用于桌面与聊天；红色「取消应用」移除当前桌宠，不删除角色资料。「当前预览」与「当前桌面角色」可能不同，修改前先确认角色名称。</td></tr>
          <tr><td>设置</td><td>打开设置窗口。左侧选模块；在「角色」页可切换正在编辑的角色、填写描述、导入或导出角色配置。</td></tr>
          <tr><td>检测 / 配置</td><td>「检测」检查已开启模块；「配置」打开当前所选角色的设置。检测可能调用云端服务，按服务商规则计费。</td></tr>
          <tr><td>使用指南 / 窗口按钮</td><td>使用指南打开本文；最小化只收起窗口，主页右上角关闭会退出 DeskAura 并关闭其窗口，关闭设置或指南不退出主程序。</td></tr>
        </tbody></table></div>
        <p>系统托盘可「显示 DeskAura」「隐藏到托盘（保持运行）」「切换窗口置顶」或「退出」。隐藏不等于退出；恢复时可双击托盘图标或选择显示。</p>
        <p class="guide-note">不必一开始就把所有模块都配好。纯文字对话以大脑为基础；内置人设、记忆与听觉模型可按需使用，MCP 和在线动作不是聊天的前置条件。</p>
      </section>

      <section v-show="visibleIds.has('interaction')" id="interaction">
        <span class="guide-kicker">02 · 桌面行为</span><h2>交互与控制</h2>
        <dl>
          <dt>角色置顶</dt><dd>让桌面角色显示在其他普通窗口上方。该项是桌面窗口行为，不会改变模型服务。</dd>
          <dt>对话气泡</dt><dd>控制角色头顶的回复气泡；关闭不影响聊天记录与回复生成。</dd>
          <dt>待机动作</dt><dd>独立决定是否自动播放待机动作，和视线追踪不是同一个开关。</dd>
          <dt>点击反馈</dt><dd>开启后，点击角色不同身体部位会出现即时动作与反馈；关闭后不再触发这类动作、气泡或语音。</dd>
          <dt>视线追踪</dt><dd>「关闭」不跟踪；「人脸」看向摄像头检测的人脸；「鼠标」跟随光标；「自动」根据当前可用目标选择。人脸相关模式会使用摄像头，需要开启视觉模块。</dd>
        </dl>
        <h3>待机什么时候开始，怎么播放</h3>
        <p>待机动作开启且角色空闲时，满足任意一项就会进入待机：摄像头有效工作时，人脸连续离开画面 10 秒；或连续 60 秒没有与角色交互。无法读取摄像头不等于已经证明人脸离开。</p>
        <div class="guide-flow" aria-label="待机动作播放顺序"><span>随机动作 · 一次</span><i aria-hidden="true">→</i><span>自然待机 · 约 8 秒</span><i aria-hidden="true">→</i><span>另一个随机动作 · 一次</span><i aria-hidden="true">→</i><span>自然待机</span></div>
        <p>交互或回复会中断自动待机。动作库里的手动「预览」用于反复观察，可能循环播放，结束时点击「停止」；它和自动待机的单次轮换不是同一种播放方式。</p>
        <h3>鼠标怎么操作角色</h3>
        <p>以下操作用于已应用的桌面角色，主页模型预览是静态展示，不响应拖动、旋转或缩放。滚轮缩放使用同一角色的固定范围；同一最终视角下，先转动再放大与先放大再转动的上限一致。到达上限后继续滚动不会反向缩小。</p>
        <div class="guide-table-wrap"><table><thead><tr><th>操作</th><th>结果</th></tr></thead><tbody>
          <tr><td>左键单击身体</td><td>触发对应部位的即时反馈，不作为一条聊天发送，也不写入长期记忆。</td></tr>
          <tr><td>左键双击角色</td><td>打开或前置聊天窗口。</td></tr>
          <tr><td>右键单击桌面角色</td><td>打开主页。</td></tr>
          <tr><td>拖动 / 中键拖动 / 滚轮</td><td>调整角色位置 / 观察角度 / 显示大小。</td></tr>
          <tr><td>连续三次点击敏感部位</td><td>可能触发边界提醒并暂时拒绝交流。道歉安抚或新建当前角色会话可清除该状态；点击其他部位会重置连续计数。</td></tr>
        </tbody></table></div>
        <p>模型必须具有可用的人形骨骼和面部结构，才能完整表现动作、眼动与口型。程序会尝试眼球骨骼与眼动表情的兼容方式，无法支持时会提示。</p>
      </section>

      <section v-show="visibleIds.has('settings')" id="settings">
        <span class="guide-kicker">03 · 所有模块通用</span><h2>配置填写与保存</h2>
        <p>先在设置的「角色」页确认角色名称，再修改模块。各角色保留各自上次保存的配置，重启或切换角色后会重新读取，不需要每次重新填写。主页与设置的模块开关、本地操作选项立即同步并自动保存，保存成功后应用到已启用的同一角色；修改其他角色不会影响当前桌宠。</p>
        <div class="guide-table-wrap"><table><thead><tr><th>字段 / 按钮</th><th>应该填什么，或者会做什么</th></tr></thead><tbody>
          <tr><td>模型来源</td><td>「内置模型」由本机运行，不填云端密钥；「API 服务」连接外部接口，也可以填你已经启动的本地 HTTP 服务。</td></tr>
          <tr><td>API 地址</td><td>复制服务商文档中对应协议的根地址，不是平台官网、控制台网址或充值页。兼容接口一般保留到 <code>/v1</code>，不额外拼 <code>/chat/completions</code> 等路径。</td></tr>
          <tr><td>模型</td><td>复制账户可调用的准确模型 ID，不填商品宣传名。不同模块需要不同类型：大脑是 LLM，人设与记忆是 Embedding，听觉是 ASR，语音是 TTS。</td></tr>
          <tr><td>API Key</td><td>粘贴该平台、该地域和该业务空间的密钥。不要填登录密码、余额或其他模块的模型名。无需鉴权的本地服务可留空。</td></tr>
          <tr><td>密钥掩码</td><td>已有密钥会以掩码提示，不会明文回填。看到输入框为空但有掩码，并不代表密钥丢失；不改密钥时保持不动即可。</td></tr>
          <tr><td>保存配置</td><td>角色已应用时仍可修改并保存，保存后应用到同一角色并发起对应检测。结果显示「配置已保存；检测未通过」时，表示内容已写入，但服务验证没有通过，不要连续重复保存。切换角色不是保存按钮。</td></tr>
          <tr><td>检测</td><td>验证模块实际工作情况，不是仅看地址能否访问。异常会显示原因；结果框固定高度，长内容在框内滚动，也可悬停查看完整提示。</td></tr>
          <tr><td>模块开关</td><td>在主页或设置「角色」页的模块概览中启停，两处立即同步，不触发检测。关闭后再开启会保留上次检测结果；连通与启用是两回事。</td></tr>
          <tr><td>模块标签 / 状态点</td><td>标签反映当前模型或 MCP 连接数量；状态点保留上次主动保存配置或检测的结果，不随后台轮询跳变。绿色不是实时在线保证；参数、密钥或设备变化后请主动重新检测。</td></tr>
        </tbody></table></div>
        <p>角色描述、角色设定、MCP 服务和 JSON 配置溢出时，点击框内右下角的几条小斜线可展开，再点收起。展开不会清空内容，也不代替保存；角色描述移开焦点自动保存，人设正文需要点击保存配置。</p>
        <h3>以阿里云百炼为例：怎样取得密钥</h3>
        <ol>
          <li>打开官方控制台，注册或登录；按平台要求完成实名、开通服务、选择地域与业务空间。</li>
          <li>在模型列表查看要使用的模型是否向当前账户开放；先看计费说明，再决定是否充值或开通付费。不要默认每种模型都有免费额度。</li>
          <li>在 API Key 管理中创建密钥并妥善保存；打开该模型的 API 文档，复制其根地址、模型 ID 和必要的音色 ID。</li>
          <li>回到 DeskAura，把信息填入对应模块，不要把 Embedding、ASR、TTS 的地址与模型互相混用。点击保存配置，阅读检测结果。</li>
        </ol>
        <p class="guide-resource"><span>官方入口</span><a :href="links.bailian" target="_blank" rel="noopener noreferrer" @click="openReference($event, links.bailian)">阿里云百炼控制台 ↗</a><a :href="links.keys" target="_blank" rel="noopener noreferrer" @click="openReference($event, links.keys)">获取 API Key 的图文步骤 ↗</a></p>
        <p class="guide-warning">API 服务只有使用软件已支持的协议才能接入。表单相似不代表任何平台、任何接口都能通用；不明白地址时，先对照该模块的参考文档。检测、对话、转写、合成与在线动作都可能产生服务商费用。</p>
      </section>

      <section v-show="visibleIds.has('persona')" id="persona">
        <span class="guide-kicker">04 · 角色是谁</span><h2>人设</h2>
        <p>人设提供身份、性格、语言习惯和背景信息。程序用文本嵌入模型检索与当前对话相关的设定，再交给大脑，不是训练或永久改写大模型。</p>
        <ol>
          <li>「角色模板」默认是「无」，可以直接在「角色设定」中写清名称、身份、性格、说话风格、与你的关系、禁忌、世界观与背景故事。「无」不套用模板，也不清空已有文字；选择其他模板会替换当前设定，先导出重要内容。已有角色会保留上次保存的模板与设定。</li>
          <li>已有文档时点「导入文档」；支持 TXT、Markdown、JSON、DOCX、PDF，文件不超过 10 MB。扫描图片 PDF 若没有文字层，不能保证提取内容。</li>
          <li>需要保留文本时点右侧「导出文档」，把当前角色设定保存为 <code>.txt</code> 文档；它只导出人设文本，不是完整角色配置或模型文件。</li>
          <li>新手选择「内置模型」BGE 即可。需要云端向量服务时切到「API 服务」，填入 Embedding 根地址、模型 ID 与密钥，最后保存并检测。</li>
        </ol>
        <div class="guide-example"><strong>设定写法示例</strong><p>名称：小沐。身份：我的学习伙伴。性格：耐心、坦率。说话风格：简洁中文，先结论后解释。关系：平等的朋友。边界：不编造已完成的文件操作，不替我决定付费，不泄露隐私。</p></div>
        <p>云端参考可使用百炼提供的 <code>text-embedding-v4</code>；API 地址复制该业务空间的 OpenAI 兼容根地址，以 <code>/compatible-mode/v1</code> 结尾，密钥地域须一致。以控制台当前可用模型为准。</p>
        <p class="guide-resource"><span>官方参考</span><a :href="links.embedding" target="_blank" rel="noopener noreferrer" @click="openReference($event, links.embedding)">阿里云百炼 · 文本向量接口 ↗</a></p>
        <p class="guide-note">角色设定中不要写 API Key、支付密码等秘密。选用云端大脑时，检索到的人设内容会作为上下文发送给该服务。</p>
      </section>

      <section v-show="visibleIds.has('memory')" id="memory">
        <span class="guide-kicker">05 · 记住相处</span><h2>记忆</h2>
        <p>记忆由 MemU 管理长期信息，原始聊天记录另行保存。不同角色使用各自的会话和记忆，不会因为模型文件相同而自动共用。</p>
        <ol>
          <li>「记忆路径」可留用角色默认值，也可填一个具体文件夹、拖入文件或文件夹、点击「选择」。选择文件时以该文件所在目录作为记忆位置。</li>
          <li>该路径中保存可迁移的 <code>memory</code> 与 <code>skill</code> Markdown 目录。建议每个角色使用独立文件夹，不要让多个角色共用。</li>
          <li>「模型来源」先用内置 BGE；外部服务填 Embedding 地址、模型和密钥，不填大脑聊天模型或 TTS 模型。</li>
          <li>保存并检测，成功后再进行几轮有意义的对话。角色是否使用某条记忆还取决于检索相关性，不是每条历史都会原样塞进回复。</li>
        </ol>
        <h3>迁移或备份记忆</h3>
        <ol>
          <li>先保存并检测，确认记忆路径中已生成 <code>memory</code> 和 <code>skill</code>。</li>
          <li>退出软件，复制这两个完整目录；恢复原始聊天记录还需要备份角色数据与会话数据库，只有 Markdown 不等于全部聊天历史。</li>
          <li>在新角色中将记忆路径指向包含这两个目录的上级文件夹，重新配置本机内置或云端 Embedding。</li>
          <li>保存并检测，程序重新导入 Markdown 并建立检索索引。用相关问题确认内容能被检索到，再删除旧备份。</li>
        </ol>
        <p class="guide-resource"><span>官方参考</span><a :href="links.embedding" target="_blank" rel="noopener noreferrer" @click="openReference($event, links.embedding)">阿里云百炼 · Embedding 模型与参数 ↗</a></p>
        <p class="guide-note">使用云端 Embedding 时，参与向量化的文本会发送给所选服务；内置 BGE 在本机运行。删除会话会移除该会话及由它单独产生的关联记忆，删除前先确认。</p>
      </section>

      <section v-show="visibleIds.has('brain')" id="brain">
        <span class="guide-kicker">06 · 理解与回复</span><h2>大脑</h2>
        <p>大脑负责理解输入、生成回复、选择情绪和提出工具调用。最小可用配置就是一个能调用的对话模型。</p>
        <h3>国产示例：DeepSeek</h3>
        <ol>
          <li>打开 DeepSeek 开放平台，登录后查看账户余额与 API Keys；按需充值并创建自己的密钥。</li>
          <li>API 地址填写 <code>https://api.deepseek.com</code>，模型从官方文档或账户控制台复制；当前官方首次调用示例使用 <code>deepseek-flash</code>。</li>
          <li>填写 API Key，保存并检测。检测通过后回到聊天窗口发送文字；关闭大脑模块会阻止正常模型回复。</li>
          <li>需要操作文件或 MCP 时，还要开启手脚并设置权限。模型必须能遵循工具调用协议，仅能聊天不等于能可靠使用工具。</li>
        </ol>
        <p class="guide-resource"><span>官方入口</span><a :href="links.deepseek" target="_blank" rel="noopener noreferrer" @click="openReference($event, links.deepseek)">DeepSeek 开放平台 ↗</a><a :href="links.deepseekDocs" target="_blank" rel="noopener noreferrer" @click="openReference($event, links.deepseekDocs)">首次 API 调用文档 ↗</a></p>
        <h3>也可以连接火山方舟等兼容服务</h3>
        <p>在火山方舟控制台开通模型、创建密钥，复制其 OpenAI 兼容根地址与实际模型或推理接入点 ID。不要把豆包网页版的登录信息当成 API Key，也不要假定网页会员包含 API 额度。</p>
        <p class="guide-resource"><span>备用入口</span><a :href="links.ark" target="_blank" rel="noopener noreferrer" @click="openReference($event, links.ark)">字节跳动 · 火山方舟控制台 ↗</a></p>
        <p class="guide-note">图片附件需要大脑模型支持图片输入；视觉模块仅检测人脸，不会让纯文本大脑自动具备“看图”能力。流式回复会逐步显示，语音合成也会分句开始。</p>
      </section>

      <section v-show="visibleIds.has('tools')" id="tools">
        <span class="guide-kicker">07 · 连接外部能力</span><h2>手脚</h2>
        <p>手脚同时管理内置文件与命令工具，以及第三方 MCP 工具。只想读写本地文件时，不必配置 MCP；开启手脚并配置「本地操作」即可。</p>
        <h3>界面从上到下怎么用</h3>
        <ol>
          <li>「MCP 服务」区域显示当前配置的服务。每个长条卡片显示连接状态、服务信息和工具入口；工具列表左侧的刷新按钮只重新连接该服务。列表随卡片数量增高，未展开时最大高度与 JSON 框相同；空列表保留一张卡片的高度。服务较多时可以内部滚动，或点击右下角斜线展开。</li>
          <li>点击某个服务的「工具列表」，查看每个工具的名称、说明和启用状态。工具默认全部开启；手动关闭后，该工具不再可被角色调用。</li>
          <li>在「JSON 配置」大文本框中填写服务配置。输入有效 JSON 后移开焦点，程序自动格式化、保存并刷新服务列表；格式错误时先修正，不要把错误提示当作连接成功。</li>
          <li>「导入配置」读取 <code>.json</code> 文件；「导出配置」保存当前 JSON。导入或覆盖前先导出已有配置，避免丢掉原服务。</li>
          <li>底部「保存配置」保存当前模块后检测全部服务；单独点击「检测」仅检测全部已保存服务，不保存编辑框草稿。工具启停点击后立即生效，无需另点保存。连上服务并不等于已有操作权限，实际调用仍受手脚开关、权限和批准策略限制。</li>
        </ol>
        <h3>JSON 结构示例</h3>
        <p>默认模板从 <code>{"mcpServers": {}}</code> 开始。下面只是格式示意，两个服务并不真实可用；请用服务提供方给出的完整配置替换占位符，不要直接照抄后检测。</p>
        <pre class="guide-code"><code>{{ mcpExample }}</code></pre>
        <div class="guide-table-wrap"><table><thead><tr><th>配置内容</th><th>如何理解</th></tr></thead><tbody>
          <tr><td>mcpServers 的键</td><td>服务的区分名称，例如「文件搜索」。一个名称对应一个服务；不要重复名称。</td></tr>
          <tr><td>url / headers</td><td>远程服务的 MCP 地址和服务商要求的请求头。不是普通网页，也不是大脑模型的聊天 API。</td></tr>
          <tr><td>command / args / env</td><td>本地服务的启动程序、参数数组和环境变量；相关程序必须已安装且可用。复制不可信命令可能让本机运行恶意程序。</td></tr>
          <tr><td>transport / disabledTools</td><td>远程默认使用 Streamable HTTP，旧 SSE 服务可填 <code>"transport": "sse"</code>；工具开关会保存为对应服务的 <code>disabledTools</code> 列表，不必手工填写。</td></tr>
          <tr><td>连接状态</td><td>表示能否完成 MCP 连接及工具发现；失败时检查程序、网络、鉴权与服务日志。工具未启用不等于服务断开。</td></tr>
          <tr><td>模块标签</td><td>只配置一个且连接成功时显示服务名；配置多个时显示 <code>MCP(已连接数/配置数)</code>，例如 <code>MCP(2/3)</code>。</td></tr>
        </tbody></table></div>
        <p class="guide-resource"><span>官方参考</span><a :href="links.mcp" target="_blank" rel="noopener noreferrer" @click="openReference($event, links.mcp)">MCP 官方参考服务与配置示例 ↗</a></p>
        <p class="guide-warning">MCP 工具由服务提供方实现，不是 DeskAura 内置的受限文件工具。保存 JSON 后的连接检测就可能启动本地服务程序，不只是保存文字；远程服务可能接收参数和文件内容。仅配置可信服务，导出 JSON 也应当作敏感文件保管。</p>
      </section>

      <section v-show="visibleIds.has('vision')" id="vision">
        <span class="guide-kicker">08 · 找到你的位置</span><h2>视觉</h2>
        <p>视觉用于摄像头与人脸检测，主要为视线追踪提供位置。它不是图像内容理解，也不负责读取屏幕文字。</p>
        <ol>
          <li>在角色模块概览开启「视觉」。进入视觉设置，选择实际使用的摄像头；不知道选哪台时先选「系统默认摄像头」。</li>
          <li>插拔或启用设备后点击「刷新设备」。设备显示“已保存但当前不可用”时，重新连接或改选可用设备。</li>
          <li>新手使用内置 BlazeFace，无需购买视觉 API。选择外部服务时按该服务的兼容要求填写 API 地址、模型与密钥，不再单独选择“服务平台”。</li>
          <li>面向摄像头并保证光线充足，点击「检测」后会立即打开所选设备；检测到人脸后自动释放本次检测使用的摄像头。没有检测到脸时不会冒充成功。</li>
          <li>需要角色持续看你时，在主页把「视线追踪」设为人脸或自动。这属于持续使用摄像头，和一次性的设置检测不同。</li>
        </ol>
        <p>检测后摄像头灯仍亮时，先检查是否还开着人脸追踪、通话摄像头或其他视频软件；这些功能有各自的设备使用需求。检测本身不会替你关闭仍在使用的其他功能。</p>
        <p class="guide-resource"><span>内置模型资料</span><a :href="links.face" target="_blank" rel="noopener noreferrer" @click="openReference($event, links.face)">MediaPipe · 人脸检测说明 ↗</a></p>
        <p class="guide-note">内置人脸检测在本机处理，不自动把画面交给大脑。通话中请求摄像头截图时会另外询问；如果你主动配置远程视觉服务，其处理范围以该服务与兼容实现为准。</p>
      </section>

      <section v-show="visibleIds.has('hearing')" id="hearing">
        <span class="guide-kicker">09 · 把声音变成文字</span><h2>听觉</h2>
        <p>听觉是 ASR（语音识别），负责识别你说的话；它和让角色说话的「语音」模块分别配置、分别启停。</p>
        <h3>先试内置，再按需要接云端</h3>
        <ol>
          <li>在主页或角色概览开启听觉，进入听觉设置。选择「内置模型」使用 SenseVoice，不需要云端密钥。</li>
          <li>使用 API 时切换到「API 服务」，填写对应识别协议的地址、模型和 API Key。没有“服务平台”选项，程序按实际地址与模型适配已支持的格式。</li>
          <li>百炼同步识别示例：使用该业务空间以 <code>/compatible-mode/v1</code> 结尾的兼容根地址，模型 <code>qwen3-asr-flash</code>，密钥与地域保持一致。</li>
          <li>保存并检测。听觉检测使用测试音频验证转写，不会替你测试物理麦克风；再到聊天窗口点麦克风，说一整句后停顿，确认文字能进入对话。</li>
          <li>Windows 需要允许桌面应用访问麦克风。可在系统设置搜索「麦克风隐私设置」，检查系统和桌面应用权限；有耳机时确认系统默认输入设备正确。</li>
        </ol>
        <p>通用兼容转写接口使用音频上传协议，百炼 Qwen ASR 使用音频消息协议。异步 filetrans、realtime WebSocket 或普通聊天模型不能因为名字中有“语音”就直接填在这里。</p>
        <p class="guide-resource"><span>官方参考</span><a :href="links.asr" target="_blank" rel="noopener noreferrer" @click="openReference($event, links.asr)">阿里云百炼 · Qwen-ASR 接入文档 ↗</a></p>
        <p class="guide-note">收音会判断说话与停顿，过滤明显空白或无效内容；嘈杂环境、太短的声音或扬声器回声仍会影响结果。使用云端听觉时，录音会发送给你配置的服务商。</p>
      </section>

      <section v-show="visibleIds.has('voice')" id="voice">
        <span class="guide-kicker">10 · 让角色开口</span><h2>语音</h2>
        <p>语音是 TTS（语音合成）。需要同时开启「语音」模块和聊天窗口的扬声器“自动语音播报”，才能自动朗读回复。</p>
        <ol>
          <li>在语音设置填写 API 地址、模型、音色 ID 与密钥。无需选择服务平台，程序按地址和模型适配已支持的合成协议。</li>
          <li>百炼北京公共原生根地址为 <code>https://dashscope.aliyuncs.com/api/v1</code>；专属业务空间或其他地域请按控制台复制原生根地址，不用 ASR 的兼容地址代替。</li>
          <li>模型可用 <code>qwen3-tts-flash</code>，音色示例 <code>Cherry</code>；下拉可选择音色，也可以输入服务商实际支持的 Voice ID。模型与音色必须互相匹配。</li>
          <li>填写密钥后保存并检测，再发一句短消息听声音。没有声音时，先检查聊天窗口扬声器开关、系统音量、默认输出设备与服务返回结果。</li>
        </ol>
        <p>平台、模型、音色不是任意混搭的。Qwen 非实时 TTS 与实时 WebSocket、声音复刻、声音设计接口并不相同；以本界面支持的合成协议和服务商文档为准。</p>
        <p class="guide-resource"><span>官方参考</span><a :href="links.tts" target="_blank" rel="noopener noreferrer" @click="openReference($event, links.tts)">阿里云百炼 · Qwen-TTS 模型与音色 ↗</a></p>
        <p class="guide-note">停用语音模块后不会偷偷换成系统声音。长回复会分句合成与播放；云端合成会把要朗读的文本发送给所选服务商。</p>
      </section>

      <section v-show="visibleIds.has('motion')" id="motion">
        <span class="guide-kicker">11 · 动作与表现</span><h2>动作</h2>
        <div class="guide-table-wrap"><table><thead><tr><th>动作模式</th><th>普通回复</th><th>明确提出动作请求</th></tr></thead><tbody>
          <tr><td>离线</td><td>本地动作库</td><td>本地动作库</td></tr><tr><td>在线</td><td>在线生成</td><td>在线生成</td></tr><tr><td>混合</td><td>本地动作库</td><td>优先在线生成</td></tr>
        </tbody></table></div>
        <ol>
          <li>只想使用内置动作时，选择「离线」，不需要为本地动作库填写云端 API。</li>
          <li>「本地动作库」分待机、回答和常用动作，自然待机排在待机列表第一项。「预览」发送给桌面已应用角色，「停止」结束预览；先确认当前桌面应用的是要观察的角色。</li>
          <li>「自动时长」由动作模型原生预测，不使用大脑随机猜秒数；固定时长显示秒数输入框，可以直接输入或用上下箭头调整。</li>
          <li>需要现场生成时，填写动作服务的 API 根地址、模型与独立密钥。腾讯 TokenHub 现有适配使用 <code>hy-3d-motion</code> 与 <code>https://tokenhub.tencentmaas.com/v1/api/3d</code>，须确认账户有对应服务权限。</li>
          <li>自建 HY-Motion 服务时，在同一个 API 地址中填写你的 Worker HTTP 地址；不是所有用户都需要另填 Worker 参数。离线库也不会因为没填在线密钥就不能预览。</li>
          <li>保存并检测。在线检测包含真实生成及动作文件校验，可能耗时并计费；服务健康页打开不等于动作已生成且能播放。</li>
        </ol>
        <p>腾讯服务的固定时长按其支持范围处理，目前为 1–12 秒整数；其他服务以实际支持为准。模型骨骼不同会影响动作重定向效果，静态模型无法表现完整肢体动作。</p>
        <p class="guide-resource"><span>官方入口</span><a :href="links.motion" target="_blank" rel="noopener noreferrer" @click="openReference($event, links.motion)">腾讯混元 · 动作模型 ↗</a><a :href="links.tencent" target="_blank" rel="noopener noreferrer" @click="openReference($event, links.tencent)">腾讯云混元控制台 ↗</a></p>
        <p class="guide-note">自动待机使用本地待机库，不会因每次伸懒腰额外调用生成 API。打瞌睡有闭眼，哼唱有口型但不会自动播放哼唱音频。</p>
      </section>

      <section v-show="visibleIds.has('call')" id="call">
        <span class="guide-kicker">12 · 日常对话</span><h2>聊天与通话</h2>
        <h3>文字、附件和历史记录</h3>
        <dl>
          <dt>输入框 / 发送</dt><dd>输入后点击发送。角色回复时可打断；继续提交的消息会进入待发送状态，最多保留一条，旁边 × 可取消。</dd>
          <dt>附件 +</dt><dd>选择文件。界面显示当前模型支持范围；图片需要支持图片的大脑模型，文档是否能读取取决于格式与大小。发送前确认没有机密内容。</dd>
          <dt>扬声器</dt><dd>打开或关闭自动语音播报，不改变听觉收音开关。语音模块关闭或未配置时，仅打开扬声器不会凭空产生声音。</dd>
          <dt>记忆 / 历史对话</dt><dd>展开会话列表，可切换、新建、改名和删除。「新建对话」开始新上下文，不删除整个角色；删除会话需要确认。</dd>
          <dt>关闭聊天</dt><dd>关闭聊天窗口不等于删除聊天记录。返回时仍按当前角色读取会话。</dd>
        </dl>
        <h3>打电话前先检查这三项</h3>
        <ol>
          <li>已应用正确角色，大脑可正常回复；该角色的听觉已开启且配置检测通过。</li>
          <li>系统麦克风权限已允许、输入设备正确；需要听角色说话时再开启语音模块和自动播报。</li>
          <li>点击聊天顶部电话开始通话，说完后停顿，识别文字会进入当前会话。麦克风图标可静音与恢复，挂断按钮结束通话并停止通话采集。</li>
        </ol>
        <div class="guide-flow" aria-label="语音对话处理顺序"><span>麦克风</span><i aria-hidden="true">→</i><span>听觉 · 转文字</span><i aria-hidden="true">→</i><span>大脑 · 回复</span><i aria-hidden="true">→</i><span>语音 · 合成</span><i aria-hidden="true">→</i><span>扬声器</span></div>
        <p>角色说话时，可点停止图标或直接说话打断。摄像机按钮切换本地画面预览，预览边缘可拖动缩放；屏幕共享按钮会让你选择共享来源。打开预览不等于每条消息都自动上传图片。</p>
        <p class="guide-warning">当角色提出摄像头或屏幕截图请求时，先阅读确认框，再决定是否允许。本次确认后才发送画面；短时采集最多为 3 张时序画面，不含音频，不是完整视频。发送给云端模型可能计费。</p>
      </section>

      <section v-show="visibleIds.has('local')" id="local">
        <span class="guide-kicker">13 · 操作前先授权</span><h2>文件与代码操作</h2>
        <p>“允许操作”由两层共同决定：沙盒权限规定能做什么，批准策略规定什么时候问你。选了完全批准不会自动扩大目录范围，也不会开启已关闭的手脚。</p>
        <h3>先设工作空间，再让角色试一次</h3>
        <ol>
          <li>在主页或设置「角色」页找到「本地操作」，开启手脚模块。</li>
          <li>创建一个专门测试的空文件夹。在「工作空间」填写其完整路径，按回车或移开焦点保存，也可点击「选择」或拖入文件夹。确认出现保存成功提示。</li>
          <li>只需编写并保存代码文件时，选「工作空间写入」；需要实际运行 Python、JavaScript、命令或第三方 MCP 时，选「完全访问权限」并理解它不是操作系统隔离沙箱。</li>
          <li>批准策略先选「请求批准」。在对话中说：“请在工作空间新建 hello.py，内容是打印一句你好，先不要运行。” 核对确认框里的文件、操作和内容后，再点「确认执行」。</li>
          <li>需要运行时另行提出请求。Python 或 Node.js 必须在本机安装并能找到；执行命令可用 PowerShell 或 cmd。结束后查看退出码、输出和实际文件，不把普通聊天中的代码块当作已执行。</li>
        </ol>
        <div class="guide-table-wrap"><table><caption>第一层：沙盒权限</caption><thead><tr><th>权限</th><th>读文件</th><th>修改文件</th><th>运行命令 / MCP</th></tr></thead><tbody>
          <tr><td>只读</td><td>工作空间内</td><td>不允许</td><td>不允许</td></tr>
          <tr><td>工作空间写入</td><td>工作空间内</td><td>工作空间内，受文件工具限制</td><td>不允许，没有可验证的系统隔离</td></tr>
          <tr><td>完全访问权限</td><td>可超出工作空间</td><td>可超出工作空间，仍有文件工具检查</td><td>按批准策略运行，可能影响其他文件或访问网络</td></tr>
        </tbody></table></div>
        <div class="guide-table-wrap"><table><caption>第二层：批准策略</caption><thead><tr><th>策略</th><th>什么时候需要确认</th></tr></thead><tbody>
          <tr><td>请求批准</td><td>写入、删除、命令、代码与 MCP 等操作先显示确认。</td></tr>
          <tr><td>帮我批准</td><td>低风险创建与修改可自动处理；删除、命令、运行代码与第三方工具仍需确认。</td></tr>
          <tr><td>完全批准</td><td>在所选权限与安全检查内自动执行，风险更高；不会绕过已关闭模块或禁用工具。</td></tr>
        </tbody></table></div>
        <p>内置文件工具主要处理普通文本与代码文件，受扩展名、大小、路径和链接检查限制，不是任意格式文档编辑器。文件修改与删除有恢复副本；通过命令或代码造成的修改没有同等自动备份或撤销保证。</p>
        <p class="guide-warning">完全访问权限下，运行的程序可能访问工作空间外资源；工作空间只是起始目录，不是 Windows 安全隔离。执行有超时和输出上限，不适合让角色开启长期后台服务。不要把“完全批准”当作关闭所有保护。</p>
      </section>

      <section v-show="visibleIds.has('data')" id="data">
        <span class="guide-kicker">14 · 保留与保护</span><h2>数据与隐私</h2>
        <h3>三种导出分别保存什么</h3>
        <div class="guide-table-wrap"><table><thead><tr><th>入口</th><th>包含 / 不包含</th></tr></thead><tbody>
          <tr><td>角色页「导出」</td><td>可迁移的角色配置；不包含模型文件和 API 密钥，也不是全部聊天历史备份。导入到已选角色会更新其配置。</td></tr>
          <tr><td>人设「导出文档」</td><td>当前角色设定的文本，便于保存与编辑；不包含其他模块设置、记忆或聊天。</td></tr>
          <tr><td>MCP「导出配置」</td><td>MCP 的 JSON 配置。认证头与环境变量可能包含秘密，导出前检查，分享前移除敏感内容。</td></tr>
        </tbody></table></div>
        <p>当前项目运行版将主要数据保存在项目同级的 <code>DeskAura-Data</code> 目录，包含各角色配置、会话数据库和应用浏览器数据；独立安装版由系统应用数据目录承载。密钥由系统凭据存储单独管理，不在普通配置里明文回填。</p>
        <ol>
          <li>完整备份前先退出 DeskAura，防止数据库和角色记录仍在写入。</li>
          <li>保留整个应用数据目录、单独设置的记忆路径和原始模型文件；只导出一份角色 JSON 不足以恢复全部历史。</li>
          <li>换电脑后重新填写 API 密钥，检查模型文件与记忆目录路径，再逐模块检测。不要把包含浏览器状态或 MCP 凭证的备份发到公开网盘。</li>
        </ol>
        <h3>哪些内容可能离开本机</h3>
        <p>选云端大脑时会发送对话、必要的人设与记忆上下文和你批准的附件；云端听觉发送录音，语音发送待朗读文本，Embedding 发送参与向量化的文本，在线动作发送动作提示。MCP 发送工具参数给所选服务。内置模型与本地动作库本身不需要云端推理。</p>
        <p class="guide-note">不同平台的密钥、计费、数据保留与隐私政策彼此独立。根据所用平台的控制台和条款管理额度、停用密钥与数据，不要仅靠关闭软件来取消云服务计费项目。</p>
      </section>

      <section v-show="visibleIds.has('help')" id="help">
        <span class="guide-kicker">15 · 按现象排查</span><h2>故障排查</h2>
        <p>先确认“正在编辑的角色”和“已应用的角色”一致，再确认模块已开启。一次只改一组参数，保存后看检测结果，可避免同时出现多个原因。</p>
        <div class="guide-table-wrap"><table><thead><tr><th>现象</th><th>从这里检查</th></tr></thead><tbody>
          <tr><td>重开后看起来没填密钥</td><td>检查是否有密钥掩码、是否换了角色。密钥不会明文回填；普通字段确实丢失时，确认上次显示保存成功。</td></tr>
          <tr><td>电话说听觉停用</td><td>看当前已应用角色的听觉开关，不是另一角色的检测结果。开启听觉后等待自动保存成功，再挂断重拨；连接成功与启用状态是两件事。</td></tr>
          <tr><td>听觉检测正常但收不到声音</td><td>检测音频不是你的物理麦克风。检查系统隐私权限、默认输入、耳机和静音；先关闭占用设备的其他软件，再说完整一句。</td></tr>
          <tr><td>能回复但没有声音</td><td>开启语音模块和聊天扬声器，检查 TTS 音色与模型搭配、系统输出设备、音量及额度。</td></tr>
          <tr><td>摄像头无画面或找不到人脸</td><td>刷新设备、重选摄像头、打开系统相机权限，避免被其他应用独占；保持正面、适当距离与光线。</td></tr>
          <tr><td>保存后角色没有立即变化</td><td>确认保存成功且修改的是已应用角色。参数只对对应模块生效，关闭的模块不会因为填了内容自动开启。</td></tr>
          <tr><td>只展示代码，没有创建文件</td><td>开启手脚、设置工作空间、检查大脑工具能力；明确要求“在工作空间创建文件”，不是仅“给我一段代码”。查看是否有待批准操作。</td></tr>
          <tr><td>权限已开但不能执行</td><td>工作空间写入可保存代码，不可运行程序；执行或 MCP 要完全访问权限。还需确认批准、运行时安装、工具未禁用，目标路径合法。</td></tr>
          <tr><td>MCP 连接失败</td><td>JSON 必须合法；本地启动程序必须存在，远程地址必须是 MCP 接口。检查认证、服务进程、网络与工具发现结果，勿用普通网站代替。</td></tr>
          <tr><td>401 / 403</td><td>通常与密钥、模型权限、地域或本地授权有关。先读完整结果，检查是否填错服务的密钥；不要把所有 403 都当作余额不足。</td></tr>
          <tr><td>404 / 模型不存在</td><td>检查 API 根地址是否多拼了路径、模型 ID 是否准确、该接口协议是否已支持。</td></tr>
          <tr><td>429 / 额度或并发限制</td><td>在服务商控制台查看余额、配额和限流；停止重复点击检测。是否充值应以账户实际提示为准。</td></tr>
          <tr><td>在线动作失败或等待很久</td><td>先用离线库确认模型能动，再查在线地址、独立密钥、模型权限和生成状态；检查只是提交成功还是已下载并验证动作文件。</td></tr>
          <tr><td>模型能显示但没有眼动或口型</td><td>检查模型是否具备有效的人形骨骼、眼球或表情通道。换用兼容的 VRM 测试，不是更换云端 API 就能修好骨骼。</td></tr>
          <tr><td>点击参考链接没有打开</td><td>确认系统已设置默认浏览器。指南中的链接打开服务商页面，不会自动替你登录、充值或创建密钥。</td></tr>
        </tbody></table></div>
        <p class="guide-closing">保留错误原文、角色名、模块名与复现步骤，排查会更快。分享截图或日志前，请遮住密钥、认证头、个人路径和私人对话。</p>
      </section>
      <footer>示例与入口于 2026-11-09 核对。模型名称、开通步骤和计费以服务商当前控制台为准；本文不提供价格或免费额度保证。</footer>
    </div>
  </main>
</template>
