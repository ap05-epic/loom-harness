// A hand-written reference React screen — stands in for what the model writes inside the loop. Used
// to prove the pipeline end-to-end (build → serve → deterministic check) without a model call.
export function App() {
  return (
    <div className="card">
      <h1 className="title">Sign in</h1>
      <form className="form" action="/auth.do" method="post">
        <label className="field">
          Username
          <input name="user" type="text" />
        </label>
        <label className="field">
          Password
          <input name="pass" type="password" />
        </label>
        <button className="btn" type="submit">
          Log in
        </button>
      </form>
      <a className="link" href="/help.do">
        Need help?
      </a>
    </div>
  );
}
