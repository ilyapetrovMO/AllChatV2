export const ALLCHAT_APP_USER_MODEL_ID = 'org.allchat.desktop';

export function configureApplicationIdentity(application: { setAppUserModelId(id: string): void }): void {
  application.setAppUserModelId(ALLCHAT_APP_USER_MODEL_ID);
}
