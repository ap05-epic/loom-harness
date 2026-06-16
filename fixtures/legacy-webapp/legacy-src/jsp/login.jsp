<%@ taglib uri="http://struts.apache.org/tags-html" prefix="html" %>
<%@ taglib uri="http://struts.apache.org/tags-bean" prefix="bean" %>
<%@ page contentType="text/html;charset=UTF-8" %>
<html>
<head>
  <title>Sign In - Example</title>
  <link rel="stylesheet" type="text/css" href="<%= request.getContextPath() %>/style.css"/>
</head>
<body>
<div class="content">
  <table class="loginbox" cellpadding="4" cellspacing="0">
    <tr><td class="loginhdr">Business Analysis &mdash; Sign In</td></tr>
    <tr><td>
      <html:errors/>
      <html:form action="/login">
        <table cellpadding="3">
          <tr><td class="lbl">User ID</td><td><html:text property="username" size="20"/></td></tr>
          <tr><td class="lbl">Password</td><td><html:password property="password" size="20"/></td></tr>
          <tr><td></td><td><html:submit styleClass="btn">Log On</html:submit></td></tr>
        </table>
      </html:form>
    </td></tr>
  </table>
</div>
</body>
</html>
