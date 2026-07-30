import {
  ArrowRight,
  CheckCircle2,
  LockKeyhole,
  Sparkles,
  Target,
  Users,
} from "lucide-react";
import {
  chatGPTSignInPath,
  chatGPTSignOutPath,
  getChatGPTUser,
} from "./chatgpt-auth";
import FlowTrackApp from "./flowtrack-app";

export const dynamic = "force-dynamic";

export default async function Page() {
  const currentUser = await getChatGPTUser();

  if (!currentUser) {
    return <AuthLanding signInHref={chatGPTSignInPath("/")} />;
  }

  return (
    <FlowTrackApp
      currentUser={currentUser}
      signOutHref={chatGPTSignOutPath("/")}
    />
  );
}

function AuthLanding({ signInHref }: { signInHref: string }) {
  return (
    <main className="auth-shell">
      <section className="auth-panel">
        <div className="auth-brand">
          <div className="auth-brand-mark">
            <Target size={25} />
          </div>
          <div>
            <strong>FlowTrack</strong>
            <span>Ваше пространство продуктивности</span>
          </div>
        </div>

        <div className="auth-copy">
          <span className="auth-kicker">
            <Sparkles size={15} />
            Всё важное — в одном месте
          </span>
          <h1>Планы не должны теряться между приложениями</h1>
          <p>
            Задачи, канбан, привычки, заметки, цели и фокус-сессии — в
            личном кабинете, который доступен с любого устройства.
          </p>
        </div>

        <div className="auth-benefits">
          <div>
            <LockKeyhole size={18} />
            <span>
              <strong>Личные данные</strong>
              Изолированы от других пользователей
            </span>
          </div>
          <div>
            <Users size={18} />
            <span>
              <strong>Для всей семьи</strong>
              У каждого свой отдельный кабинет
            </span>
          </div>
          <div>
            <CheckCircle2 size={18} />
            <span>
              <strong>Без нового пароля</strong>
              Безопасный вход через ChatGPT
            </span>
          </div>
        </div>

        <a className="auth-primary" href={signInHref}>
          Войти или зарегистрироваться
          <ArrowRight size={18} />
        </a>
        <p className="auth-footnote">
          При первом входе FlowTrack автоматически создаст ваш личный кабинет.
        </p>
      </section>

      <aside className="auth-visual" aria-label="Возможности FlowTrack">
        <div className="auth-orbit auth-orbit-one" />
        <div className="auth-orbit auth-orbit-two" />
        <div className="auth-preview-card auth-preview-today">
          <span>Сегодня</span>
          <strong>6 задач</strong>
          <i>4 выполнено</i>
        </div>
        <div className="auth-preview-card auth-preview-focus">
          <span>Фокус</span>
          <strong>25:00</strong>
          <i>Помодоро</i>
        </div>
        <div className="auth-preview-card auth-preview-habit">
          <span>Серия привычки</span>
          <strong>12 дней</strong>
          <i>Продолжайте!</i>
        </div>
        <div className="auth-visual-center">
          <Target size={38} />
          <strong>Один ритм.<br />Один FlowTrack.</strong>
        </div>
      </aside>
    </main>
  );
}
