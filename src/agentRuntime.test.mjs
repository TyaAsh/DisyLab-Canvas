import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import ts from 'typescript'

const source = await readFile(new URL('./agent.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText
const agent = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)
const compileModule = async (path) => ts.transpileModule(await readFile(new URL(path, import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText
const asModule = (value) => `data:text/javascript;base64,${Buffer.from(value).toString('base64')}`
const zod = JSON.stringify(import.meta.resolve('zod'))
const schema = asModule((await compileModule('./skills/manifestSchema.ts')).replace("'zod'", zod))
const author = await import(asModule((await compileModule('./skills/authoring.ts'))
  .replace("'zod'", zod).replace("'./manifestSchema'", JSON.stringify(schema))))
const skillImporter = await import(asModule((await compileModule('./skills/importExport.ts'))
  .replace("'yaml'", JSON.stringify(import.meta.resolve('yaml'))).replace("'./manifestSchema'", JSON.stringify(schema))))
const skillPrompt = await import(asModule((await compileModule('./skills/prompt.ts'))
  .replace("'handlebars'", JSON.stringify(import.meta.resolve('handlebars')))))
const filmManifestModule = asModule(await compileModule('./skills/manifests/official/film.ts'))
const { moveCanvasLayer } = await import(asModule(await compileModule('./canvasLayers.ts')))
const { resolveAgentTextEditTargets, prepareAgentCanvasEdits, applyAgentCanvasEdits, revertAgentCanvasEdits } = await import(asModule(await compileModule('./agentCanvasEdits.ts')))
const { activeAgentTeamRoles, normalizeAgentProjectSettings, projectMemoryPrompt, runAgentTeam } = await import(asModule(await compileModule('./agentProject.ts')))
const { OFFICIAL_FILM_SKILLS } = await import(filmManifestModule)
const skillConversation = await import(asModule((await compileModule('./skills/conversation.ts'))
  .replace("'./manifests/official/film'", JSON.stringify(filmManifestModule))
  .replace("'./guides'", JSON.stringify(asModule(await compileModule('./skills/guides.ts'))))))

test('explicit image specs reach the confirmation card rather than composer defaults', () => {
  const defaults = { aspectRatio: '1:1', resolution: '1K', detail: 'auto', count: 1 }
  const draft = { ...defaults, prompt: '系列海报第1张，竖版3:4' }
  assert.deepEqual(agent.resolveAgentImageDraftSettings('生成两张，比例 ３：４，2K，画质高', draft, defaults), {
    aspectRatio: '3:4', resolution: '2K', detail: 'high', count: 2,
  })
  assert.deepEqual(agent.resolveAgentImageDraftSettings('做系列第2张海报', draft, defaults), { ...defaults, aspectRatio: '3:4' })
  assert.equal(agent.resolveAgentImageDraftSettings('改成横版 16:9', draft, defaults).aspectRatio, '16:9')
})

test('ordinary clarification and explicit inspection never expose mutation proposals', () => {
  const read = agent.inferAgentInteractionMode('检查画布为什么生成失败')
  const write = agent.inferAgentInteractionMode('直接生成一张海报')
  const clarification = agent.parseAgentReply('{"reply":"想做什么尺寸？","questions":[{"prompt":"横版还是竖版？","options":["横版","竖版"]}]}')
  assert.equal(read.mode, 'inspect')
  assert.equal(agent.agentReplyAllowsProposals(read, { decision: write }), false)
  assert.equal(agent.agentReplyAllowsProposals(write, clarification), false)
  assert.equal(agent.agentReplyAllowsProposals(write, {}), true)
})

test('project team templates choose distinct roles and the last role receives the prior work and memory', async () => {
  const settings = normalizeAgentProjectSettings({
    memory: [{ id: 'one', kind: 'constraint', text: '成片用竖版' }],
    team: { template: 'production', models: { producer: 'local::model-a' }, disabled: ['screenwriter'] },
  })
  const roles = activeAgentTeamRoles(settings.team)
  assert.deepEqual(roles.map(({ id }) => id), ['producer', 'director', 'productionReview'])
  assert.deepEqual(activeAgentTeamRoles(normalizeAgentProjectSettings({ team: { template: 'copy' } }).team).map(({ id }) => id), ['copywriter', 'copyReview'])
  const calls = []
  const reply = await runAgentTeam(roles, projectMemoryPrompt(settings.memory), new AbortController().signal, async (role, prompt) => {
    calls.push({ id: role.id, prompt })
    return `交付 ${role.label}`
  })
  assert.equal(reply, '交付 执行制片')
  assert.match(calls.at(-1).prompt, /成片用竖版/)
  assert.match(calls.at(-1).prompt, /交付 制片人/)
  assert.match(calls.at(-1).prompt, /交付 分镜导演/)
})

test('canvas text suggestions stay within explicitly selected or uniquely named targets', () => {
  const nodes = [
    { id: 'a', data: { kind: 'text', title: 'A', body: '原文 A' } },
    { id: 'b', data: { kind: 'text', title: 'B', body: '原文 B' } },
    { id: 'image', data: { kind: 'image', title: 'A', body: '提示词' } },
  ]
  assert.equal(agent.requestsAgentCanvasTextEdits('修改画布布局', false), false)
  assert.equal(agent.requestsAgentCanvasTextEdits('把选中的文本改短', true), true)
  assert.deepEqual(resolveAgentTextEditTargets(nodes, ['a'], '把《B》改短').map((node) => node.id), ['b'])
  assert.deepEqual(resolveAgentTextEditTargets([...nodes, { ...nodes[0], id: 'other' }], ['b'], '改写《A》'), [])
  const reply = agent.parseAgentReply(JSON.stringify({ textEdits: [{ nodeId: 'a', body: '新 A', kind: 'image' }, { nodeId: 'image', title: '越界' }, { nodeId: 'b', body: '' }] }))
  assert.deepEqual(prepareAgentCanvasEdits(resolveAgentTextEditTargets(nodes, ['a', 'b'], '把选中文案改短'), reply.textEdits), [
    { nodeId: 'a', before: { title: 'A', body: '原文 A' }, after: { body: '新 A' }, included: true },
  ])
})

test('canvas edit approval is atomic for included targets and leaves unchecked targets and node metadata unchanged', () => {
  const nodes = [
    { id: 'a', position: { x: 100, y: 200 }, data: { kind: 'text', title: 'A', body: '原文 A', promptText: '已写好的提示词' } },
    { id: 'b', data: { kind: 'text', title: 'B', body: '原文 B' } },
  ]
  const edits = prepareAgentCanvasEdits(nodes, [{ nodeId: 'a', body: '新 A' }, { nodeId: 'b', title: '新 B' }])
  const modified = [nodes[0], { ...nodes[1], data: { ...nodes[1].data, body: '用户后来改的 B' } }]
  assert.equal(applyAgentCanvasEdits(modified, edits).ok, false)
  assert.equal(applyAgentCanvasEdits(nodes, edits, 'a').ok, false)
  const partial = applyAgentCanvasEdits(modified, [edits[0], { ...edits[1], included: false }])
  assert.equal(partial.ok, true)
  assert.deepEqual(partial.nodeIds, ['a'])
  assert.equal(partial.nodes[0].data.body, '新 A')
  assert.equal(partial.nodes[0].data.promptText, '已写好的提示词')
  assert.strictEqual(partial.nodes[0].position, nodes[0].position)
  assert.strictEqual(partial.nodes[1], modified[1])
  const approved = [edits[0], { ...edits[1], included: false }]
  const reverted = revertAgentCanvasEdits(partial.nodes, approved)
  assert.equal(reverted.ok, true)
  assert.deepEqual(reverted.nodes, modified)
  assert.equal(revertAgentCanvasEdits([nodes[0], modified[1]], approved).ok, false)
})

test('layer reordering moves a group and its descendants without changing their parents', () => {
  const nodes = [{ id: 'a' }, { id: 'b' }, { id: 'a1', parentId: 'a' }, { id: 'a2', parentId: 'a' }, { id: 'b1', parentId: 'b' }]
  const moved = moveCanvasLayer(nodes, { sourceId: 'a', targetId: 'b', placement: 'before' })
  assert.deepEqual(moved.map(({ id }) => id), ['b', 'b1', 'a', 'a1', 'a2'])
  const reordered = moveCanvasLayer(moved, { sourceId: 'a1', targetId: 'a2', placement: 'before' })
  assert.deepEqual(reordered.map(({ id }) => id), ['b', 'b1', 'a', 'a2', 'a1'])
  assert.strictEqual(moveCanvasLayer(reordered, { sourceId: 'a1', targetId: 'b1', placement: 'before' }), reordered)
})

test('a Skill drafted for direct use stays instant when saved', () => {
  const draft = { name: '清理文案', description: '整理一段文字', kind: 'text', execution: 'instant', instructions: '修正用词并只返回成稿。' }
  const result = author.parseSkillAuthorReply(JSON.stringify({ draft }))
  assert.equal(author.createAuthoredSkill(result.draft).execution, 'instant')
})

test('a handoff for a toy animation requires a photo and keeps supported user specs', () => {
  const skill = OFFICIAL_FILM_SKILLS.find(({ slug }) => slug === 'toy-animation')
  const { filmDraft } = agent.parseAgentReply(JSON.stringify({
    reply: '准备好给小狐狸拍一段定格动画了。',
    filmDraft: { subject: '小狐狸给机械花上发条。', values: { duration: 15, ratio: '4:3', toyStyle: '毛毡定格', resolution: '720p' } },
  }))
  assert.equal(skillConversation.resolveFilmDraft(skill, filmDraft, false), null)
  assert.deepEqual(skillConversation.resolveFilmDraft(skill, filmDraft, true)?.values, {
    duration: 15, ratio: '4:3', toyStyle: '毛毡定格', language: '中文', withScene: true, resolution: '720p',
  })
  assert.equal(skillConversation.resolveFilmDraft(skill, { ...filmDraft, values: { duration: 1500 } }, true), null)
  assert.equal(agent.parseAgentReply('{"reply":"说说你想拍什么","filmDraft":{"subject":"广告","values":[]}}').filmDraft, undefined)
})

test('game footage does not enter the synthetic concept PV pipeline', () => {
  const skill = OFFICIAL_FILM_SKILLS.find(({ slug }) => slug === 'gameplay-pv')
  const draft = { subject: '用天球仪打开星门', values: { game: '星门观测站', sellingPoints: '旋转天球仪', channel: 'Steam', sourceMode: '真实实机录屏' } }
  assert.equal(skillConversation.resolveFilmDraft(skill, draft, true), null)
  const concept = skillConversation.resolveFilmDraft(skill, { ...draft, values: { ...draft.values, sourceMode: '设定图或概念图' } }, true)
  assert.equal(concept?.values.duration, 30)
  assert.equal(concept?.values.ratio, '16:9')
})

test('cartoon ad drafts identify missing or invalid fields before creating a confirmation card', () => {
  const skill = OFFICIAL_FILM_SKILLS.find(({ slug }) => slug === 'cartoon-ad')
  const { filmDraft } = agent.parseAgentReply(JSON.stringify({
    reply: '耳机广告可以整理成确认稿了。',
    filmDraft: { subject: '展示纯白光滑的 tya 头戴式耳机。', values: { brand: 'tya', ratio: '16:9 横屏' } },
  }))
  const { draft, issue } = skillConversation.checkFilmDraft(skill, filmDraft, false)
  assert.equal(draft, null)
  assert.deepEqual(issue.fields.map(({ name }) => name), ['ratio', 'performance', 'logo'])
  assert.ok(issue.questions[0].options.includes('16:9'))
  assert.match(issue.message, /品牌 Logo 名称/)

  const repaired = skillConversation.checkFilmDraft(skill, {
    ...filmDraft, values: { brand: 'tya', ratio: '16:9', performance: '通勤者戴上耳机', logo: 'tya' },
  }, false)
  assert.equal(repaired.issue, null)
  assert.equal(repaired.draft.subject, filmDraft.subject)
  assert.equal(repaired.draft.values.duration, 30)
})

test('asking why a film confirmation card is missing can recover a draft even when labeled inspect', () => {
  const skill = OFFICIAL_FILM_SKILLS.find(({ slug }) => slug === 'cartoon-ad')
  const message = '为什么还没有确认卡呀'
  const localDecision = agent.inferAgentInteractionMode(message)
  const requested = skillConversation.requestsFilmConfirmation(message)
  assert.equal(localDecision.mode, 'inspect')
  assert.equal(requested, true)
  assert.equal(skillConversation.requestsFilmConfirmation('排查确认卡的接口代码'), false)

  const reply = { reply: '请在确认卡核对成片设定。', decision: localDecision }
  assert.equal(skillConversation.assessFilmReply(skill, reply, localDecision, requested, false).needsRepair, true)
  const filmDraft = { subject: '展示纯白光滑的 tya 头戴式耳机。', values: { brand: 'tya', performance: '设计师戴上耳机', logo: 'tya' } }
  assert.ok(skillConversation.assessFilmReply(skill, { ...reply, filmDraft }, localDecision, requested, false).check.draft)
  const questions = [{ prompt: '片尾显示什么字样？', options: [] }]
  assert.equal(skillConversation.assessFilmReply(skill, { ...reply, questions }, localDecision, requested, false).needsRepair, false)
  assert.equal(skillConversation.assessFilmReply(skill, reply, agent.inferAgentInteractionMode('继续'), false, false).needsRepair, true)
})

test('every official film Skill waits for approved first frames before requesting video', async () => {
  const fakeMedia = asModule(`
    export const generateRemoteImages = (settings, options) => settings.image(options)
    export const generateRemoteVideo = (settings, options) => settings.video(options)
    export const publicImageSourceUrl = (url) => url
    export const readImageSourceBlob = async () => new Blob(['mock image'])
    export const getGrsaiVideoCapabilities = () => undefined
    export const hfsyVideoLimits = (model) => model === 'kling-o3' ? { minSeconds: 5, maxSeconds: 15, images: 8 } : undefined
    export const isHfsyNativeSeedance = (model) => model === 'doubao-seedance-2.0'
    export const seedanceVideoDefaults = () => ({ ratios: ['16:9'], minDuration: 4, maxDuration: 15, defaultResolution: '720p', resolutions: ['480p', '720p'] })
    export const resolveProviderLabel = () => 'HFSY'
  `)
  const { generateFilmClips, filmRequestCounts, filmStoryboardPanels, filmVideoProfile } = await import(asModule((await compileModule('./skills/filmProduction.ts'))
    .replace("'../imageApi'", JSON.stringify(fakeMedia))
    .replace("'./manifests/official/film'", JSON.stringify(filmManifestModule))
    .replace("'./guides'", JSON.stringify(asModule(await compileModule('./skills/guides.ts'))))))
  assert.equal(filmVideoProfile('mock', 'doubao-seedance-2.0').maxImages, 9)
  assert.equal(filmVideoProfile('mock', 'kling-o3').maxImages, 8)
  assert.deepEqual(filmStoryboardPanels(12, 6, 30), [{ board: 0, first: 8, last: 9 }, { board: 1, first: 10, last: 11 }])
  assert.deepEqual(filmStoryboardPanels(11, 4, 15), [{ board: 0, first: 7, last: 9 }])

  for (const skill of OFFICIAL_FILM_SKILLS) {
    let approved = false
    const imageUrls = []
    const videoFrames = []
    const imagesOnCanvas = new Map()
    let videoOnCanvas = false
    const values = Object.fromEntries(skill.parameters.filter((field) => field.default !== undefined).map((field) => [field.name, field.default]))
    if (skill.slug === 'cartoon-ad') Object.assign(values, { logo: 'tya', duration: 30, multiscene: true })
    const profile = { ratios: ['16:9'], minSeconds: 3, maxSeconds: 15, resolution: '720p', resolutions: ['480p', '720p'], requiresPublicImage: false }
    await generateFilmClips({
      skill, values, subject: '示例短片', ratio: '16:9', duration: values.duration, mapStoryboardPanels: true,
      profile,
      references: ['https://mock.invalid/original.png'], signal: new AbortController().signal,
      image: { image: async ({ aspectRatio, referenceImages }) => {
        const task = imagesOnCanvas.get(imageUrls.length)
        assert.ok(task, skill.slug)
        assert.equal(aspectRatio, task.aspectRatio)
        if (task.stage === 'storyboard' && task.title.endsWith('2/2')) {
          assert.ok(referenceImages.includes(imageUrls[4]), 'second storyboard includes the first board')
        }
        const url = `https://mock.invalid/image-${imageUrls.length}.png`
        imageUrls.push(url)
        return [{ url }]
      } },
      video: { video: async ({ referenceImages, prompt }) => {
        assert.equal(approved, true, skill.slug)
        assert.equal(videoOnCanvas, true, skill.slug)
        if (skill.slug === 'cartoon-ad') {
          assert.ok(referenceImages.includes(imageUrls[0]), 'video includes the character anchor')
          assert.ok(referenceImages.some((url) => [imageUrls[4], imageUrls[5]].includes(url)), 'video includes the storyboard')
          assert.doesNotMatch(prompt, /背景音乐|BGM/)
          assert.match(prompt, /只按九宫格第/)
        }
        videoFrames.push(referenceImages[0])
        return { blob: new Blob(['mock video']) }
      } },
      onProgress() {}, onLog() {},
      async onImageStart(task) { imagesOnCanvas.set(task.index, task) },
      async onMedia(media) {
        if (media.kind === 'image') assert.ok(imagesOnCanvas.has(media.index), skill.slug)
      },
      async onVideoStart(indices) {
        assert.equal(approved, true, skill.slug)
        assert.ok(indices.every((index) => imagesOnCanvas.get(index)?.stage === 'keyframe'), skill.slug)
        videoOnCanvas = true
      },
      async review(stage) {
        if (stage.title === '分镜关键帧') {
          assert.equal(videoFrames.length, 0, skill.slug)
          assert.ok(stage.assets.length, skill.slug)
          approved = true
        }
        return { action: 'continue', notes: '' }
      },
    })
    assert.ok(videoFrames.length, skill.slug)
    assert.deepEqual(filmRequestCounts(skill, values.duration, profile, values), { images: imageUrls.length, videos: videoFrames.length }, skill.slug)
    assert.deepEqual(videoFrames, imageUrls.slice(-videoFrames.length), skill.slug)
    if (skill.slug === 'cartoon-ad') {
      assert.deepEqual([...imagesOnCanvas.values()].slice(0, 4).map(({ title }) => title), ['角色立绘', '独立产品道具', '角色关联道具', '场景道具'])
      assert.equal(imagesOnCanvas.get(0).aspectRatio, '1:1')
      assert.ok([...imagesOnCanvas.values()].some(({ title }) => title === '品牌落版图'))
    }
  }
})

test('SKILL.md imports YAML and preserves Markdown instructions as literal text', async () => {
  const text = '\uFEFF---\r\nname: creative-brief\r\ndescription: >-\r\n  整理创作需求。\r\n  提供可执行步骤。\r\nallowed-tools: Bash\r\n---\r\n保留 {{示例}}。'
  const skill = await skillImporter.importSkillFile(new File([text], 'SKILL.md'))
  assert.equal(skill.id, 'user.markdown.creative-brief')
  assert.equal(skill.description, '整理创作需求。 提供可执行步骤。')
  assert.equal(skill.kind, 'text')
  assert.deepEqual(skill.capability.supportedModes, [])
  assert.equal(skillPrompt.renderSkillPrompt(skill, '新品发布'), '保留 {{示例}}。\n\n本次任务\n新品发布')
})

test('Skill folder import skips unrelated JSON and still accepts legacy manifests', async () => {
  assert.equal(await skillImporter.importSkillFile(new File(['{"name":"workspace"}'], 'package.json'), true), null)
  const draft = author.createAuthoredSkill({ name: '海报', description: '设计产品海报', kind: 'image', instructions: '给出构图。' })
  const skill = await skillImporter.importSkillFile(new File([JSON.stringify(draft)], 'poster.json'), true)
  assert.equal(skill.kind, 'image')
  assert.equal(skillPrompt.renderSkillPrompt(skill, '新品'), '给出构图。\n\n本次任务\n新品')
  await assert.rejects(skillImporter.importSkillFile(new File(['---\nname: BAD\n---\n说明'], 'SKILL.md')), /name/)
  await assert.rejects(skillImporter.importSkillFile(new File(['---\nname: test\ndescription: 简介\n---\n'], 'SKILL.md')), /执行说明/)
})

test('Skill authoring accepts batched single and multiple-choice questions with distinct options', () => {
  const turn = author.parseSkillAuthorReply(JSON.stringify({ questions: [
    { prompt: '多长？', options: ['15 秒', '30 秒', '30 秒'] },
    { prompt: '加哪些？', options: ['配音', '字幕'], multiple: true },
  ] }))
  assert.deepEqual(turn.questions.map(({ options, multiple }) => [options, multiple]), [
    [['15 秒', '30 秒'], false], [['配音', '字幕'], true],
  ])
  assert.throws(() => author.parseSkillAuthorReply('{"questions":[{"options":[]}]}'), /格式不完整/)
})

test('authored drafts become validated, configurable local skills with a single safe task placeholder', () => {
  const draft = { name: '短视频科普规则', description: '组织知识短片', kind: 'video', instructions: '写三个镜头。' }
  const skill = author.createAuthoredSkill(draft)
  assert.equal(skill.source, 'user')
  assert.equal(skill.execution, 'configured')
  assert.equal(skill.output.type, 'video')
  assert.equal(skill.template.prompt, '写三个镜头。\n\n本次任务\n{{subject}}')
  assert.throws(() => author.createAuthoredSkill({ ...draft, instructions: '{{#if subject}}test{{/if}}' }), /双花括号/)
})

test('explicit planning and execution language route to different modes', () => {
  assert.equal(agent.inferAgentInteractionMode('先给我计划，暂时不要执行').mode, 'plan')
  assert.equal(agent.inferAgentInteractionMode('就按第二个方案开始制作').mode, 'execute')
  assert.equal(agent.inferAgentInteractionMode('检查一下当前画布的问题').mode, 'inspect')
  assert.equal(agent.inferAgentInteractionMode('这个？').mode, 'clarify')
})

test('structured model decision survives protocol parsing', () => {
  const parsed = agent.parseAgentReply(JSON.stringify({
    decision: { mode: 'execute', confidence: 0.91, needsApproval: true, reason: '用户已确认方案' },
    reply: '请确认后开始生成。',
  }))
  assert.deepEqual(parsed.decision, {
    mode: 'execute', confidence: 0.91, needsApproval: true, reason: '用户已确认方案',
  })
})

test('long conversations retain a compact older summary and exact recent turns', () => {
  const messages = Array.from({ length: 16 }, (_, index) => ({
    id: String(index), role: index % 2 ? 'assistant' : 'user', content: `消息 ${index}`, createdAt: '',
  }))
  const context = agent.buildAgentConversationContext(messages, 4)
  assert.match(context, /较早对话摘要/)
  assert.match(context, /消息 0/)
  assert.match(context, /最近对话/)
  assert.match(context, /消息 15/)
})
