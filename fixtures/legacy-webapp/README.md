# Legacy fixture — Example Business Analysis

A miniature legacy webapp that is the harness's permanent test bed. It exercises every archetype the real target (a Struts 1.x / JSP app) exposes — server-rendered HTML, sessions, form posts, a multi-step wizard, a popup window, and a frameset — with deterministic data and authentic early-2000s markup/CSS.

It has two faces, on purpose:

## 1. The runnable app — `src/LegacyApp.java`

A **dependency-free** Java program (JDK's built-in HTTP server) that serves the screens. No Maven, no Jetty, no servlet/JSP version juggling — it compiles with `javac` and runs on any JDK 17+ (dev, the pod, CI). This is what the **surveyor** crawls and the **evaluator** screenshots.

```bash
cd fixtures/legacy-webapp
javac -d out src/LegacyApp.java
java -cp out LegacyApp 8090       # http://127.0.0.1:8090/   (login: analyst / analyst)
```

Or from code, via `@loom/test-kit`:

```ts
import { LegacyFixture } from '@loom/test-kit';
const fixture = new LegacyFixture({ port: 8090 });
const baseUrl = await fixture.start(); // compiles if needed, waits until it's up
// ...crawl / eval baseUrl...
await fixture.stop();
```

Screens: `/login` · `/list` (filterable grid) · `/wizard?step=1..3` · `/popup?id=…` · `/frameset`.

## 2. The legacy source — `legacy-src/`

Authentic Struts/JSP source artifacts that mirror the same screens — `WEB-INF/struts-config.xml` (action → forward → JSP), `WEB-INF/web.xml` (the ActionServlet + auth filter), `WEB-INF/tiles-defs.xml` (layout composition), and `jsp/*.jsp` (real Struts/JSTL/Tiles taglibs and includes). These are the **cartographer's** parse targets — the files from which it recovers the screen graph and generates documentation. They are not executed by the runnable app; they are the source-of-record the mapper reads.

## Why split it this way

The two needs — *parse authentic legacy source* and *crawl a running app* — are met without forcing the brittle 2008 Struts runtime onto a modern JDK. The cartographer gets real `struts-config.xml`/JSP to parse; the surveyor gets a real, instantly-runnable app to crawl; and every legacy-relevant construct (Struts actions, Tiles, session auth, wizard, popup, frameset, 2000s CSS) has a miniature twin here, so "works on the fixture" is the strongest proxy for "works on the real app."
