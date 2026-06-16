<%@ taglib uri="http://tiles.apache.org/tags-tiles" prefix="tiles" %>
<%@ page contentType="text/html;charset=UTF-8" %>
<!DOCTYPE html>
<html>
<head>
  <title><tiles:insertAttribute name="title"/> - Example</title>
  <link rel="stylesheet" type="text/css" href="<%= request.getContextPath() %>/style.css"/>
</head>
<body>
  <tiles:insertAttribute name="header"/>
  <div class="content">
    <tiles:insertAttribute name="body"/>
  </div>
  <tiles:insertAttribute name="footer"/>
</body>
</html>
