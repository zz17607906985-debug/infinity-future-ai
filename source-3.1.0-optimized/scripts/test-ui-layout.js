'use strict';

const assert = require('node:assert/strict');
const {chromium} = require(process.env.FUTURE_AI_PLAYWRIGHT_MODULE || 'playwright');

const auditControls = (scope = 'body') => {
  let checked = 0;
  const issues = [];
  const root = document.querySelector(scope);
  if (!root) return {checked, issues};
  for (const control of root.querySelectorAll('button,a[href],input:not([type=hidden]),select,textarea')) {
    const rect = control.getBoundingClientRect();
    if (!rect.width || !rect.height || !control.checkVisibility({checkOpacity: true, checkVisibilityCSS: true})) continue;
    const clip = {left: 0, top: 34, right: innerWidth, bottom: innerHeight};
    for (let parent = control.parentElement; parent; parent = parent.parentElement) {
      const style = getComputedStyle(parent);
      const bounds = parent.getBoundingClientRect();
      if (/auto|scroll|hidden|clip/.test(style.overflowX)) {
        clip.left = Math.max(clip.left, bounds.left);
        clip.right = Math.min(clip.right, bounds.right);
      }
      if (/auto|scroll|hidden|clip/.test(style.overflowY)) {
        clip.top = Math.max(clip.top, bounds.top);
        clip.bottom = Math.min(clip.bottom, bounds.bottom);
      }
    }
    const width = Math.min(rect.right, clip.right) - Math.max(rect.left, clip.left);
    const height = Math.min(rect.bottom, clip.bottom) - Math.max(rect.top, clip.top);
    if (width < 2 || height < 2) continue;
    checked += 1;
    const name = control.id || control.getAttribute('aria-label') || control.getAttribute('title') || control.textContent.trim().slice(0, 40);
    const hit = document.elementFromPoint(Math.max(rect.left, clip.left) + width / 2, Math.max(rect.top, clip.top) + height / 2);
    if (hit && hit !== control && !control.contains(hit) && !hit.contains(control) && !control.disabled) {
      issues.push({type: 'covered', name, by: hit.id || hit.className});
    }
    if (rect.left < clip.left - 2 || rect.right > clip.right + 2) issues.push({type: 'horizontal-clip', name});
    if (control.scrollWidth > control.clientWidth + 3 && !['TEXTAREA', 'INPUT', 'SELECT'].includes(control.tagName)) {
      issues.push({type: 'text-overflow', name});
    }
  }
  return {size: [innerWidth, innerHeight], checked, issues};
};

async function main() {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const page = browser.contexts().flatMap(context => context.pages()).find(candidate => candidate.url().includes('/app.asar/src/index.html'));
  assert.ok(page, 'Open the installed application with --remote-debugging-port=9222 first.');
  const session = await page.context().newCDPSession(page);
  const original = await page.evaluate(() => ({workspace: document.body.className.match(/workspace-(short|assistant|music|canvas)/)?.[1] || 'short', stage: document.querySelector('.short-block-nav.active')?.dataset.shortJump || 'idea', scroll: document.querySelector('.short-main').scrollTop}));
  const results = [];
  const check = async (scope, label) => {
    const result = await page.evaluate(auditControls, scope);
    assert.ok(result.checked > 0, label + ': no visible controls checked');
    results.push({label, ...result});
    assert.deepEqual(result.issues, [], label + ': clipped or covered controls');
  };
  const switchWorkspace = async workspace => {
    const desktop = page.locator('.nav-pills [data-workspace="' + workspace + '"]');
    if (await desktop.isVisible()) await desktop.click();
    else {
      await page.locator('#workspaceMenuToggle').click();
      await page.locator('[data-workspace-mobile="' + workspace + '"]').click();
    }
  };
  try {
    for (const [width, height] of [[1100, 720], [1280, 800], [1440, 920]]) {
      await session.send('Emulation.setDeviceMetricsOverride', {width, height, deviceScaleFactor: 1, mobile: false});
      await switchWorkspace('short');
      for (const stage of ['idea', 'assets', 'video']) {
        await page.locator('[data-short-jump="' + stage + '"]').click();
        const layout = await page.evaluate(() => {
          const header = document.querySelector('.manju-head').getBoundingClientRect();
          const status = document.querySelector('#shortProductionStatus').getBoundingClientRect();
          const layout = document.querySelector('.short-layout').getBoundingClientRect();
          return {contained: status.top >= header.top && status.bottom <= header.bottom, separated: header.bottom <= layout.top + 1, direction: getComputedStyle(document.querySelector('#shortProductionStatus')).flexDirection};
        });
        assert.equal(layout.contained && layout.separated, true, 'Production status escaped its header');
        assert.equal(layout.direction, 'row');
        const main = page.locator('.short-main');
        const maxScroll = await main.evaluate(element => element.scrollHeight - element.clientHeight);
        for (let offset = 0; offset <= maxScroll + 450; offset += 450) {
          await main.evaluate((element, value) => {element.scrollTo({top: value, behavior: 'instant'});}, Math.min(offset, maxScroll));
          await check('#shortWorkbench', width + '/' + stage + '/' + offset);
          if (offset >= maxScroll) break;
        }
      }
      for (const [toggle, drawer, close] of [['#queueToggle', '#queueDrawer', '#closeQueue'], ['#historyToggle', '#historyDrawer', '#closeHistory']]) {
        await page.locator(toggle).click();
        await page.locator(close).click({trial: true});
        await check(drawer, width + '/' + drawer);
        await page.locator(close).click();
      }
      await page.locator('#shortManageSkill').click();
      await check('#shortSkillManager', width + '/skill-dialog');
      await page.locator('#shortSkillManager').getByRole('button', {name: '关闭', exact: true}).click();
      for (const workspace of ['assistant', 'music']) {
        await switchWorkspace(workspace);
        await check(workspace === 'assistant' ? '#assistantWorkbench' : '#musicWorkbench', width + '/' + workspace);
        if (workspace === 'assistant') {
          const panelLayout = await page.evaluate(() => {
            const workbench = document.querySelector('#assistantWorkbench');
            const header = workbench.querySelector('.assistant-studio-head').getBoundingClientRect();
            const shell = workbench.querySelector('.assistant-studio-shell').getBoundingClientRect();
            const thread = workbench.querySelector('.dialog-thread');
            const compose = workbench.querySelector('.assistant-compose-dock');
            return {
              sharedHeader: workbench.querySelector('.assistant-studio-head').classList.contains('manju-head'),
              breadcrumbUnique: workbench.querySelectorAll('#assistantBreadcrumb').length === 1,
              breadcrumbInPanel: workbench.querySelector('.assistant-panel-head').contains(document.getElementById('assistantBreadcrumb')),
              headerFits: header.bottom <= shell.top + 1,
              composeFits: !thread || !compose || (thread.getBoundingClientRect().bottom <= compose.getBoundingClientRect().top + 1 && compose.getBoundingClientRect().bottom <= shell.bottom),
              controlsPresent: ['assistantModelSelect', 'assistantContextModeInline', 'assistantOpenCanvas'].every(id => workbench.querySelector('.assistant-studio-head').contains(document.getElementById(id)))
            };
          });
          assert.ok(Object.values(panelLayout).every(Boolean), 'Assistant studio layout lost controls or overlaps its composer');
          for (const view of ['scheduled', 'skills', 'plugins']) {
            await page.locator('[data-codex-view="' + view + '"]').click();
            await check('#assistantWorkbench', width + '/assistant/' + view);
          }
          const task = page.locator('[data-codex-project-topic]').first();
          if (await task.isVisible()) await task.click();
        }
      }
      const playerFits = await page.locator('.music-player').evaluate(element => [...element.children].every(child => child.getBoundingClientRect().bottom <= element.getBoundingClientRect().bottom && child.getBoundingClientRect().top >= element.getBoundingClientRect().top));
      assert.ok(playerFits, 'Media player controls are vertically clipped');
      await check('.topbar', width + '/toolbar');
      const toolbarFits = await page.evaluate(() => {
        const left = document.querySelector('.top-left').getBoundingClientRect();
        const right = document.querySelector('.top-actions').getBoundingClientRect();
        return left.right <= right.left && right.right <= innerWidth - 148 && right.top >= 34;
      });
      assert.ok(toolbarFits, 'Toolbar navigation collides with actions or native window controls');
      await page.locator('#topSettings').click();
      await page.locator('#closeSettings').click({trial: true});
      await check('#settingsDrawer', width + '/settings');
      await page.locator('#closeSettings').click();
    }
    console.log('Installed application UI layout passed: ' + results.length + ' viewport/flow/scroll checks.');
  } finally {
    for (const close of ['#closeSettings', '#closeQueue', '#closeHistory', '#shortSkillManager button[data-skill-close]']) {
      if (await page.locator(close).isVisible()) await page.locator(close).click();
    }
    await session.send('Emulation.clearDeviceMetricsOverride');
    await switchWorkspace(original.workspace);
    if (original.workspace === 'short') {
      await page.locator('[data-short-jump="' + original.stage + '"]').click();
      await page.locator('.short-main').evaluate((element, value) => {element.scrollTop = value;}, original.scroll);
    }
    await session.detach();
  }
}

main().then(() => process.exit(0)).catch(error => {console.error(error); process.exit(1);});
