import { HANDLED_LABEL_NAME } from "./config.js";
import { createLabel, listLabels } from "./oauth.js";
import { getGmailAccount, saveGmailAccount } from "./store.js";

export async function ensureHandledLabel(accountEmail) {
  const account = await getGmailAccount(accountEmail);
  if (account?.handledLabelId) return account.handledLabelId;

  const labels = await listLabels(accountEmail);
  let label = labels.find((l) => l.name === HANDLED_LABEL_NAME);
  if (!label) {
    label = await createLabel(accountEmail, HANDLED_LABEL_NAME);
  }

  await saveGmailAccount({
    ...account,
    handledLabelId: label.id,
  });
  return label.id;
}
