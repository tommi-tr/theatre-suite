import { useMemo, useState } from "react";
import { useT } from "@theatre-suite/core";
import { CopyPreview, Dialog, Switch } from "@theatre-suite/ui";
import { copyText } from "../lib/api";
import { useDoc } from "../store/doc";
import { useUi } from "../store/ui";
import { visiblePeople } from "../sections/People";
import { roleLabel } from "../sections/roles";

/** The list of the company as text, to paste in a group chat or an email. Names only by default. */
export function CopyListDialog() {
  const t = useT();
  const people = useDoc((s) => s.data.people);
  const [withRoles, setWithRoles] = useState(true);
  const [withPhone, setWithPhone] = useState(false);
  const [withEmail, setWithEmail] = useState(false);
  const list = visiblePeople(people);
  const text = useMemo(
    () =>
      list
        .map((p) => {
          const parts = [p.name];
          if (withRoles && p.roles.length) parts.push(p.roles.map((r) => roleLabel(t, r)).join(", "));
          if (withPhone && p.phone) parts.push(p.phone);
          if (withEmail && p.email) parts.push(p.email);
          return parts.join(" · ");
        })
        .join("\n"),
    [list, withRoles, withPhone, withEmail, t],
  );
  return (
    <Dialog
      title={t("Copy the list")}
      icon="copy"
      description={list.length < people.length ? t("{n} of {total} people: the ones shown by the search.", { n: list.length, total: people.length }) : undefined}
      onClose={() => useUi.getState().closeDialog()}
      width={560}
    >
      <div className="cn-copyopts">
        <label className="cn-switchrow">
          <Switch checked={withRoles} onChange={setWithRoles} label={t("Roles")} />
          {t("Roles")}
        </label>
        <label className="cn-switchrow">
          <Switch checked={withPhone} onChange={setWithPhone} label={t("Phone")} />
          {t("Phone")}
        </label>
        <label className="cn-switchrow">
          <Switch checked={withEmail} onChange={setWithEmail} label={t("Email")} />
          {t("Email")}
        </label>
      </div>
      <CopyPreview
        text={text}
        copy={async (s) => {
          try {
            await copyText(s);
          } catch (e) {
            useUi.getState().showToast(String(e), "error");
          }
        }}
        labels={{ copy: t("Copy"), copied: t("Copied") }}
        emptyText={t("Nobody to copy.")}
      />
      <p className="ts-field__hint" style={{ marginTop: 10 }}>
        {t("Phone numbers and emails are added only if you switch them on.")}
      </p>
    </Dialog>
  );
}
