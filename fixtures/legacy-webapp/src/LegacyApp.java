import com.sun.net.httpserver.Headers;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Example Business Analysis — a miniature legacy webapp used as the harness's test bed.
 *
 * It deliberately renders authentic early-2000s server-rendered HTML (table layout,
 * Verdana, beveled controls) with sessions, form posts, a multi-step wizard, a popup,
 * and a frameset — the screen archetypes a Struts/JSP app exposes — but with ZERO
 * external dependencies so it compiles with javac and runs on any JDK 17+.
 *
 * Run:  java -cp out LegacyApp [port]      (default 8080)
 * Login: analyst / analyst
 */
public final class LegacyApp {

  // ---- deterministic seed data -------------------------------------------------
  record Deal(String id, String name, String region, String segment, int amount, String status) {}

  static final List<Deal> DEALS = List.of(
      new Deal("BA-1001", "Helvetia Trading", "EMEA", "Corporate", 1250000, "Open"),
      new Deal("BA-1002", "Nordwind Logistics", "EMEA", "Mid-Market", 430000, "Open"),
      new Deal("BA-1003", "Pacific Foods", "APAC", "Corporate", 980000, "Pending"),
      new Deal("BA-1004", "Andes Mining", "AMER", "Corporate", 2100000, "Open"),
      new Deal("BA-1005", "Sakura Components", "APAC", "Mid-Market", 275000, "Closed"),
      new Deal("BA-1006", "Rhein Pharma", "EMEA", "Corporate", 1675000, "Open"),
      new Deal("BA-1007", "Lone Star Energy", "AMER", "Mid-Market", 520000, "Pending"),
      new Deal("BA-1008", "Great Lakes Steel", "AMER", "Corporate", 1340000, "Open"));

  static final Map<String, Session> SESSIONS = new ConcurrentHashMap<>();

  static final class Session {
    String user;
    String wEntity = "";
    String wPeriod = "";
    String wSplit = "";
  }

  public static void main(String[] args) throws IOException {
    int port = args.length > 0 ? Integer.parseInt(args[0]) : 8080;
    HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", port), 0);
    server.createContext("/", LegacyApp::route);
    server.setExecutor(null);
    server.start();
    System.out.println("Example Business Analysis (legacy fixture) on http://127.0.0.1:" + port + "/");
  }

  // ---- routing -----------------------------------------------------------------
  static void route(HttpExchange ex) throws IOException {
    String path = ex.getRequestURI().getPath();
    try {
      switch (path) {
        case "/", "/login" -> login(ex);
        case "/logout" -> logout(ex);
        case "/style.css" -> css(ex);
        case "/list" -> guard(ex, LegacyApp::list);
        case "/wizard" -> guard(ex, LegacyApp::wizard);
        case "/popup" -> guard(ex, LegacyApp::popup);
        case "/frameset" -> guard(ex, LegacyApp::frameset);
        case "/frames/nav" -> guard(ex, LegacyApp::frameNav);
        case "/frames/content" -> guard(ex, LegacyApp::frameContent);
        default -> send(ex, 404, "text/html", page("Not Found", "<p>No such screen.</p>"));
      }
    } catch (RuntimeException e) {
      send(ex, 500, "text/html", page("Error", "<pre>" + esc(e.toString()) + "</pre>"));
    }
  }

  interface Handler { void handle(HttpExchange ex, Session s) throws IOException; }

  static void guard(HttpExchange ex, Handler h) throws IOException {
    Session s = current(ex);
    if (s == null) {
      redirect(ex, "/login");
      return;
    }
    h.handle(ex, s);
  }

  // ---- screens -----------------------------------------------------------------
  static void login(HttpExchange ex) throws IOException {
    if (ex.getRequestMethod().equalsIgnoreCase("POST")) {
      Map<String, String> form = formBody(ex);
      if ("analyst".equals(form.get("username")) && "analyst".equals(form.get("password"))) {
        String token = UUID.randomUUID().toString();
        Session s = new Session();
        s.user = form.get("username");
        SESSIONS.put(token, s);
        ex.getResponseHeaders().add("Set-Cookie", "APPSESSION=" + token + "; Path=/");
        redirect(ex, "/list");
        return;
      }
      send(ex, 200, "text/html", loginPage("Invalid username or password."));
      return;
    }
    if (current(ex) != null) {
      redirect(ex, "/list");
      return;
    }
    send(ex, 200, "text/html", loginPage(null));
  }

  static String loginPage(String error) {
    StringBuilder b = new StringBuilder();
    b.append("<table class='loginbox' cellpadding='4' cellspacing='0'><tr><td class='loginhdr'>")
        .append("Business Analysis &mdash; Sign In</td></tr><tr><td>");
    if (error != null) b.append("<div class='error'>").append(esc(error)).append("</div>");
    b.append("<form method='post' action='/login'>")
        .append("<table cellpadding='3'>")
        .append("<tr><td class='lbl'>User ID</td><td><input type='text' name='username' size='20'></td></tr>")
        .append("<tr><td class='lbl'>Password</td><td><input type='password' name='password' size='20'></td></tr>")
        .append("<tr><td></td><td><input type='submit' class='btn' value='Log On'></td></tr>")
        .append("</table></form></td></tr></table>");
    return page("Sign In", b.toString(), false);
  }

  static void logout(HttpExchange ex) throws IOException {
    String token = cookie(ex, "APPSESSION");
    if (token != null) SESSIONS.remove(token);
    ex.getResponseHeaders().add("Set-Cookie", "APPSESSION=; Path=/; Max-Age=0");
    redirect(ex, "/login");
  }

  static void list(HttpExchange ex, Session s) throws IOException {
    Map<String, String> q = query(ex);
    String region = q.getOrDefault("region", "");
    StringBuilder b = new StringBuilder();
    b.append("<h1>Deal Pipeline</h1>");
    b.append("<form method='get' action='/list' class='filter'>")
        .append("Region: <select name='region'>")
        .append(opt("", "(all)", region))
        .append(opt("EMEA", "EMEA", region))
        .append(opt("APAC", "APAC", region))
        .append(opt("AMER", "AMER", region))
        .append("</select> <input type='submit' class='btn' value='Go'></form>");
    b.append("<table class='grid' cellpadding='4' cellspacing='0'><tr class='gridhdr'>")
        .append("<th>ID</th><th>Name</th><th>Region</th><th>Segment</th><th class='num'>Amount</th><th>Status</th><th></th></tr>");
    int row = 0;
    for (Deal d : DEALS) {
      if (!region.isEmpty() && !d.region().equals(region)) continue;
      b.append("<tr class='").append(row++ % 2 == 0 ? "even" : "odd").append("'>")
          .append("<td>").append(d.id()).append("</td>")
          .append("<td>").append(esc(d.name())).append("</td>")
          .append("<td>").append(d.region()).append("</td>")
          .append("<td>").append(d.segment()).append("</td>")
          .append("<td class='num'>").append(String.format("%,d", d.amount())).append("</td>")
          .append("<td>").append(d.status()).append("</td>")
          .append("<td><a href=\"javascript:void(window.open('/popup?id=").append(d.id())
          .append("','det','width=420,height=320'))\">details</a></td>")
          .append("</tr>");
    }
    b.append("</table>");
    b.append("<p><a class='btn' href='/wizard?step=1'>New Analysis</a> ")
        .append("<a class='btn' href='/frameset'>Classic View</a></p>");
    send(ex, 200, "text/html", page("Deal Pipeline", b.toString()));
  }

  static void wizard(HttpExchange ex, Session s) throws IOException {
    if (ex.getRequestMethod().equalsIgnoreCase("POST")) {
      Map<String, String> f = formBody(ex);
      if (f.containsKey("entity")) s.wEntity = f.get("entity");
      if (f.containsKey("period")) s.wPeriod = f.get("period");
      if (f.containsKey("split")) s.wSplit = f.get("split");
      String next = f.getOrDefault("next", "1");
      if ("submit".equals(next)) {
        send(ex, 200, "text/html", page("Analysis Submitted",
            "<h1>Analysis Submitted</h1><div class='ok'>Request for <b>" + esc(s.wEntity)
                + "</b> (" + esc(s.wPeriod) + ", split " + esc(s.wSplit)
                + ") has been queued.</div><p><a class='btn' href='/list'>Back to Pipeline</a></p>"));
        return;
      }
      redirect(ex, "/wizard?step=" + next);
      return;
    }
    String step = query(ex).getOrDefault("step", "1");
    StringBuilder b = new StringBuilder();
    b.append("<h1>New Analysis</h1>");
    b.append("<table class='steps' cellpadding='3' cellspacing='0'><tr>")
        .append(stepTab("1", "Entity", step))
        .append(stepTab("2", "Parameters", step))
        .append(stepTab("3", "Review", step))
        .append("</tr></table>");
    b.append("<form method='post' action='/wizard'>");
    switch (step) {
      case "2" -> {
        b.append("<table cellpadding='3'>")
            .append("<tr><td class='lbl'>Period</td><td><select name='period'>")
            .append(opt("Q1", "Q1", s.wPeriod)).append(opt("Q2", "Q2", s.wPeriod))
            .append(opt("Q3", "Q3", s.wPeriod)).append(opt("Q4", "Q4", s.wPeriod))
            .append("</select></td></tr>")
            .append("<tr><td class='lbl'>Split</td><td><input name='split' value='").append(esc(s.wSplit)).append("'></td></tr>")
            .append("</table>")
            .append("<input type='hidden' name='entity' value='").append(esc(s.wEntity)).append("'>")
            .append(navButtons("1", "3"));
      }
      case "3" -> {
        b.append("<table class='review' cellpadding='4' cellspacing='0'>")
            .append("<tr><td class='lbl'>Entity</td><td>").append(esc(s.wEntity)).append("</td></tr>")
            .append("<tr><td class='lbl'>Period</td><td>").append(esc(s.wPeriod)).append("</td></tr>")
            .append("<tr><td class='lbl'>Split</td><td>").append(esc(s.wSplit)).append("</td></tr>")
            .append("</table>")
            .append("<input type='hidden' name='next' value='submit'>")
            .append("<p><a class='btn' href='/wizard?step=2'>Back</a> ")
            .append("<input type='submit' class='btn' value='Submit'></p>");
      }
      default -> {
        b.append("<table cellpadding='3'><tr><td class='lbl'>Entity</td><td><input name='entity' value='")
            .append(esc(s.wEntity)).append("' size='30'></td></tr></table>")
            .append("<input type='hidden' name='next' value='2'>")
            .append("<p><input type='submit' class='btn' value='Next &raquo;'></p>");
      }
    }
    b.append("</form>");
    send(ex, 200, "text/html", page("New Analysis", b.toString()));
  }

  static void popup(HttpExchange ex, Session s) throws IOException {
    String id = query(ex).getOrDefault("id", "");
    Deal found = DEALS.stream().filter(d -> d.id().equals(id)).findFirst().orElse(null);
    StringBuilder b = new StringBuilder();
    if (found == null) {
      b.append("<p>Unknown deal.</p>");
    } else {
      b.append("<table class='review' cellpadding='4' cellspacing='0'>")
          .append("<tr><td class='lbl'>ID</td><td>").append(found.id()).append("</td></tr>")
          .append("<tr><td class='lbl'>Name</td><td>").append(esc(found.name())).append("</td></tr>")
          .append("<tr><td class='lbl'>Region</td><td>").append(found.region()).append("</td></tr>")
          .append("<tr><td class='lbl'>Amount</td><td>").append(String.format("%,d", found.amount())).append("</td></tr>")
          .append("<tr><td class='lbl'>Status</td><td>").append(found.status()).append("</td></tr>")
          .append("</table>");
    }
    b.append("<p><a href=\"javascript:window.close()\">Close</a></p>");
    // bare window (no nav chrome)
    send(ex, 200, "text/html", page("Deal " + esc(id), b.toString(), false));
  }

  static void frameset(HttpExchange ex, Session s) throws IOException {
    String html = "<!DOCTYPE html><html><head><title>Example Classic</title></head>"
        + "<frameset cols='180,*'>"
        + "<frame name='nav' src='/frames/nav'>"
        + "<frame name='content' src='/frames/content'>"
        + "</frameset></html>";
    send(ex, 200, "text/html", html);
  }

  static void frameNav(HttpExchange ex, Session s) throws IOException {
    String body = "<div class='navframe'><b>Menu</b><ul>"
        + "<li><a href='/frames/content' target='content'>Summary</a></li>"
        + "<li><a href='/list' target='_top'>Modern List</a></li>"
        + "<li><a href='/logout' target='_top'>Log Off</a></li></ul></div>";
    send(ex, 200, "text/html", page("Nav", body, false));
  }

  static void frameContent(HttpExchange ex, Session s) throws IOException {
    int total = DEALS.stream().mapToInt(Deal::amount).sum();
    String body = "<h1>Summary</h1><p>Open deals across all regions.</p>"
        + "<table class='grid' cellpadding='4' cellspacing='0'><tr class='gridhdr'><th>Region</th><th class='num'>Deals</th></tr>"
        + regionRow("EMEA") + regionRow("APAC") + regionRow("AMER")
        + "</table><p>Total pipeline: <b>" + String.format("%,d", total) + "</b></p>";
    send(ex, 200, "text/html", page("Summary", body, false));
  }

  static String regionRow(String r) {
    long n = DEALS.stream().filter(d -> d.region().equals(r)).count();
    return "<tr class='even'><td>" + r + "</td><td class='num'>" + n + "</td></tr>";
  }

  // ---- layout & helpers --------------------------------------------------------
  static String page(String title, String body) { return page(title, body, true); }

  static String page(String title, String body, boolean chrome) {
    StringBuilder b = new StringBuilder();
    b.append("<!DOCTYPE html><html><head><meta charset='utf-8'><title>")
        .append(esc(title)).append(" - Example</title>")
        .append("<link rel='stylesheet' type='text/css' href='/style.css'></head><body>");
    if (chrome) {
      b.append("<table class='banner' width='100%' cellpadding='0' cellspacing='0'><tr>")
          .append("<td class='brand'>Example&nbsp;Business&nbsp;Analysis</td>")
          .append("<td class='nav'><a href='/list'>Pipeline</a> | <a href='/wizard?step=1'>New</a> | <a href='/logout'>Log Off</a></td>")
          .append("</tr></table>");
    }
    b.append("<div class='content'>").append(body).append("</div></body></html>");
    return b.toString();
  }

  static void css(HttpExchange ex) throws IOException {
    String css = "body{font-family:Verdana,Arial,sans-serif;font-size:11px;color:#333;background:#e8e8e8;margin:0}"
        + ".banner{background:#1f3a5f;border-bottom:2px solid #c0c0c0}"
        + ".brand{color:#fff;font-weight:bold;font-size:13px;padding:6px 10px}"
        + ".nav{color:#cfe;text-align:right;padding:6px 10px}.nav a{color:#fff;text-decoration:none}"
        + ".content{padding:12px}"
        + "h1{font-size:15px;color:#1f3a5f;border-bottom:1px solid #aaa;padding-bottom:3px}"
        + ".btn{font-family:Verdana;font-size:11px;background:#dcdcdc;border:1px solid #888;"
        + "border-top-color:#fff;border-left-color:#fff;padding:2px 8px;text-decoration:none;color:#000;cursor:pointer}"
        + "table.grid{background:#fff;border:1px solid #888}.grid th{background:#5b7ca5;color:#fff;text-align:left}"
        + ".grid .even{background:#fff}.grid .odd{background:#eef2f7}.num{text-align:right}"
        + "input,select{font-family:Verdana;font-size:11px;border:1px solid #888}"
        + ".loginbox{margin:60px auto;width:300px;background:#fff;border:1px solid #888}"
        + ".loginhdr{background:#1f3a5f;color:#fff;font-weight:bold;padding:5px}"
        + ".lbl{color:#555;font-weight:bold}.error{color:#a00;font-weight:bold;padding:4px}"
        + ".ok{color:#070;background:#dfd;border:1px solid #7a7;padding:6px;margin:6px 0}"
        + ".filter{background:#d6d6d6;border:1px solid #aaa;padding:5px;margin:6px 0}"
        + "table.steps td{border:1px solid #888;padding:3px 10px;background:#dcdcdc}"
        + "table.steps td.active{background:#5b7ca5;color:#fff;font-weight:bold}"
        + ".navframe{padding:8px;font-size:11px}.navframe ul{padding-left:16px}";
    send(ex, 200, "text/css", css);
  }

  static String opt(String value, String label, String selected) {
    return "<option value='" + value + "'" + (value.equals(selected) ? " selected" : "") + ">" + label + "</option>";
  }

  static String stepTab(String n, String label, String current) {
    return "<td class='" + (n.equals(current) ? "active" : "") + "'>" + n + ". " + label + "</td>";
  }

  static String navButtons(String prev, String next) {
    return "<p><a class='btn' href='/wizard?step=" + prev + "'>&laquo; Back</a> "
        + "<button class='btn' type='submit' name='next' value='" + next + "'>Next &raquo;</button></p>";
  }

  // ---- request plumbing --------------------------------------------------------
  static Session current(HttpExchange ex) {
    String token = cookie(ex, "APPSESSION");
    return token == null ? null : SESSIONS.get(token);
  }

  static String cookie(HttpExchange ex, String name) {
    List<String> cookies = ex.getRequestHeaders().get("Cookie");
    if (cookies == null) return null;
    for (String header : cookies) {
      for (String part : header.split(";")) {
        String[] kv = part.trim().split("=", 2);
        if (kv.length == 2 && kv[0].equals(name)) return kv[1];
      }
    }
    return null;
  }

  static Map<String, String> query(HttpExchange ex) {
    return parse(ex.getRequestURI().getRawQuery());
  }

  static Map<String, String> formBody(HttpExchange ex) throws IOException {
    byte[] raw = ex.getRequestBody().readAllBytes();
    return parse(new String(raw, StandardCharsets.UTF_8));
  }

  static Map<String, String> parse(String s) {
    Map<String, String> map = new LinkedHashMap<>();
    if (s == null || s.isEmpty()) return map;
    for (String pair : s.split("&")) {
      String[] kv = pair.split("=", 2);
      String k = URLDecoder.decode(kv[0], StandardCharsets.UTF_8);
      String v = kv.length > 1 ? URLDecoder.decode(kv[1], StandardCharsets.UTF_8) : "";
      map.put(k, v);
    }
    return map;
  }

  static void redirect(HttpExchange ex, String location) throws IOException {
    ex.getResponseHeaders().add("Location", location);
    ex.sendResponseHeaders(302, -1);
    ex.close();
  }

  static void send(HttpExchange ex, int status, String type, String body) throws IOException {
    byte[] out = body.getBytes(StandardCharsets.UTF_8);
    Headers h = ex.getResponseHeaders();
    h.add("Content-Type", type + "; charset=utf-8");
    ex.sendResponseHeaders(status, out.length);
    try (OutputStream os = ex.getResponseBody()) {
      os.write(out);
    }
  }

  static String esc(String s) {
    if (s == null) return "";
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\"", "&quot;");
  }

  private LegacyApp() {}
}
