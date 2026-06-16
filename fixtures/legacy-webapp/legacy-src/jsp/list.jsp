<%@ taglib uri="http://struts.apache.org/tags-html" prefix="html" %>
<%@ taglib uri="http://struts.apache.org/tags-bean" prefix="bean" %>
<%@ taglib uri="http://struts.apache.org/tags-logic" prefix="logic" %>
<%@ taglib uri="http://java.sun.com/jsp/jstl/core" prefix="c" %>
<%@ taglib uri="http://java.sun.com/jsp/jstl/fmt" prefix="fmt" %>
<%@ page contentType="text/html;charset=UTF-8" %>

<h1>Deal Pipeline</h1>

<html:form action="/list" method="get" styleClass="filter">
  Region:
  <html:select property="region">
    <html:option value="">(all)</html:option>
    <html:option value="EMEA">EMEA</html:option>
    <html:option value="APAC">APAC</html:option>
    <html:option value="AMER">AMER</html:option>
  </html:select>
  <html:submit styleClass="btn">Go</html:submit>
</html:form>

<table class="grid" cellpadding="4" cellspacing="0">
  <tr class="gridhdr">
    <th>ID</th><th>Name</th><th>Region</th><th>Segment</th>
    <th class="num">Amount</th><th>Status</th><th>&nbsp;</th>
  </tr>
  <logic:iterate id="deal" name="deals" type="com.example.legacy.web.model.Deal">
    <tr>
      <td><bean:write name="deal" property="id"/></td>
      <td><bean:write name="deal" property="name"/></td>
      <td><bean:write name="deal" property="region"/></td>
      <td><bean:write name="deal" property="segment"/></td>
      <td class="num"><fmt:formatNumber value="${deal.amount}" type="number"/></td>
      <td><bean:write name="deal" property="status"/></td>
      <td>
        <a href="javascript:void(window.open('<html:rewrite action="/popup"/>?id=<bean:write name="deal" property="id"/>','det','width=420,height=320'))">details</a>
      </td>
    </tr>
  </logic:iterate>
</table>

<p>
  <html:link action="/wizard" styleClass="btn">New Analysis</html:link>
</p>
