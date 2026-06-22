// A hand-written reference React screen — stands in for what the model writes inside the loop. Used
// to prove the pipeline end-to-end (build → serve → deterministic check) without a model call.
// Its styling lives in THIS component (an inline <style>), not the shared scaffold, so the scaffold
// imposes nothing on a real conversion — the replica's computed styles come entirely from the model.
const STYLES = `
  * { box-sizing: border-box; }
  body { margin: 0; font-family: Arial, sans-serif; background: #f4f4f4; }
  .card { width: 320px; margin: 60px auto; padding: 24px; background: #ffffff; border: 1px solid #cccccc; }
  .title { margin: 0 0 16px; font-size: 20px; color: #333333; }
  .form { display: flex; flex-direction: column; gap: 12px; }
  .field { display: flex; flex-direction: column; gap: 4px; font-size: 13px; color: #555555; }
  .field input { padding: 6px; border: 1px solid #bbbbbb; font-size: 14px; }
  .btn { padding: 8px; border: none; background: #11aa55; color: #ffffff; font-size: 14px; cursor: pointer; }
  .link { display: inline-block; margin-top: 12px; font-size: 13px; color: #11aa55; }
`;

export function App() {
  return (
    <>
      <style>{STYLES}</style>
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
    </>
  );
}
