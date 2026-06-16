import { describe, expect, test } from 'vitest';
import { parseStrutsConfig } from './struts-parser.js';

const XML = `<?xml version="1.0"?>
<!DOCTYPE struts-config PUBLIC "-//Apache//DTD" "x.dtd">
<struts-config>
  <form-beans>
    <form-bean name="loginForm" type="com.example.legacy.web.form.LoginForm"/>
    <form-bean name="analysisForm" type="com.example.legacy.web.form.AnalysisForm"/>
  </form-beans>
  <global-forwards>
    <forward name="login" path="/login.do"/>
  </global-forwards>
  <action-mappings>
    <action path="/login" type="com.example.legacy.web.action.LoginAction" name="loginForm" input="/jsp/login.jsp">
      <forward name="success" path="/list.do" redirect="true"/>
      <forward name="failure" path="/jsp/login.jsp"/>
    </action>
    <action path="/list" type="com.example.legacy.web.action.DealListAction">
      <forward name="success" path="/jsp/list.jsp"/>
    </action>
  </action-mappings>
</struts-config>`;

describe('parseStrutsConfig', () => {
  test('extracts form beans', () => {
    const cfg = parseStrutsConfig(XML);
    expect(cfg.formBeans).toEqual([
      { name: 'loginForm', type: 'com.example.legacy.web.form.LoginForm' },
      { name: 'analysisForm', type: 'com.example.legacy.web.form.AnalysisForm' },
    ]);
  });

  test('extracts actions with their attributes', () => {
    const cfg = parseStrutsConfig(XML);
    const login = cfg.actions.find((a) => a.path === '/login')!;
    expect(login.type).toBe('com.example.legacy.web.action.LoginAction');
    expect(login.name).toBe('loginForm');
    expect(login.input).toBe('/jsp/login.jsp');
  });

  test('extracts per-action forwards including redirect flag', () => {
    const cfg = parseStrutsConfig(XML);
    const login = cfg.actions.find((a) => a.path === '/login')!;
    expect(login.forwards).toEqual([
      { name: 'success', path: '/list.do', redirect: true },
      { name: 'failure', path: '/jsp/login.jsp', redirect: false },
    ]);
  });

  test('extracts global forwards', () => {
    expect(parseStrutsConfig(XML).globalForwards).toEqual([{ name: 'login', path: '/login.do' }]);
  });

  test('normalizes a single action (not wrapped in an array)', () => {
    const single = `<struts-config><action-mappings>
      <action path="/only" type="X"><forward name="ok" path="/x.jsp"/></action>
    </action-mappings></struts-config>`;
    const cfg = parseStrutsConfig(single);
    expect(cfg.actions).toHaveLength(1);
    expect(cfg.actions[0]!.forwards).toHaveLength(1);
  });

  test('handles an empty/missing config gracefully', () => {
    const cfg = parseStrutsConfig('<struts-config></struts-config>');
    expect(cfg.actions).toEqual([]);
    expect(cfg.formBeans).toEqual([]);
  });
});
