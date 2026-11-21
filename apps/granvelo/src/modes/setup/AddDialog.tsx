import { useMemo, useState } from "react";
import { useT } from "@theatre-suite/core";
import { Button, Dialog, Segmented } from "@theatre-suite/ui";
import { FixtureSymbol } from "../../common/FixtureSymbol";
import { channelsInUse } from "../../model/addresses";
import { FIXTURE_TYPES } from "../../model/fixtureTypes";
import { addFixtures, autoNames, listGroups, type AddPlace, type AddressStart } from "../../model/ops";
import type { FixtureTypeId } from "../../model/types";
import { fmtAddress } from "../../lib/format";
import { useDoc } from "../../store/doc";
import { useUi } from "../../store/ui";
import { FieldNumber, autoNameBase, trussName } from "./common";
import { useSetup } from "./store";

type StartKind = "next" | "at" | "none";

/** "Aggiungi luce": type, how many, name, where, and the first address. Everything has a believable default. */
export function AddDialog() {
  const t = useT();
  const doc = useDoc((s) => s.doc)!;
  const close = () => useSetup.getState().setAddOpen(false);
  const [typeId, setTypeId] = useState<FixtureTypeId>("parRgb");
  const [count, setCount] = useState(1);
  const [typed, setTyped] = useState<string | null>(null);
  const [placeKey, setPlaceKey] = useState<string>(() => {
    const trusses = listGroups(doc).filter((g) => g.key.kind === "truss");
    return trusses.length ? `truss:${(trusses[0].key as { trussId: string }).trussId}` : "newTruss";
  });
  const [startKind, setStartKind] = useState<StartKind>("next");
  const [startAt, setStartAt] = useState(1);

  const base = typed ?? autoNameBase(t, typeId);
  const place: AddPlace = placeKey.startsWith("truss:") ? { kind: "truss", trussId: placeKey.slice(6) } : (({ house: { kind: "house" }, floating: { kind: "floating" }, floor: { kind: "floor" }, newTruss: { kind: "newTruss" } }) as Record<string, AddPlace>)[placeKey];
  const names = useMemo(() => autoNames(doc, base, count), [doc, base, count]);
  const address: AddressStart = startKind === "next" ? { kind: "next" } : startKind === "at" ? { kind: "at", address: startAt } : { kind: "none" };

  const preview = useMemo(() => {
    const r = addFixtures(doc, { typeId, count, baseName: base, place, address });
    const added = r.doc.fixtures.slice(doc.fixtures.length);
    const addrs = added.map((f) => f.address).filter((a): a is number => a !== null);
    return { addrs, unaddressed: r.unaddressed, total: channelsInUse(r.doc) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, typeId, count, base, placeKey, startKind, startAt]);

  const submit = () => {
    let ids: string[] = [];
    let unaddressed = 0;
    useDoc.getState().change((d) => {
      const r = addFixtures(d, { typeId, count, baseName: base, place, address });
      ids = r.ids;
      unaddressed = r.unaddressed;
      return r.doc;
    });
    useUi.getState().setSelection(ids, ids[ids.length - 1], ids[0]);
    useUi.getState().showToast(
      (ids.length === 1 ? t("Light added.") : t("{n} lights added.", { n: ids.length })) + (unaddressed ? ` ${unaddressed === 1 ? t("1 has no address: there is no room.") : t("{n} have no address: there is no room.", { n: unaddressed })}` : ""),
    );
    close();
  };

  const range = preview.addrs.length ? (preview.addrs.length === 1 ? fmtAddress(preview.addrs[0]) : `${fmtAddress(preview.addrs[0])}…`) : "";
  const lastName = names[names.length - 1];

  return (
    <Dialog
      title={t("Add lights")}
      icon="bulb"
      width={600}
      onClose={close}
      closeLabel={t("Close")}
      footer={
        <>
          <span className="gv-su-add__sum ts-muted ts-ellipsis">
            {count === 1 ? t("1 light") : t("{n} lights", { n: count })}
            {names[0] ? ` · ${names[0]}${count > 1 ? ` … ${lastName}` : ""}` : ""}
            {startKind === "none" ? "" : preview.addrs.length ? ` · ${t("Address")} ${range}` : ""}
          </span>
          <span className="ts-spacer" />
          <Button variant="ghost" onClick={close}>
            {t("Cancel")}
          </Button>
          <Button variant="primary" icon="plus" onClick={submit} autoFocus>
            {count === 1 ? t("Add 1 light") : t("Add {n} lights", { n: count })}
          </Button>
        </>
      }
    >
      <form
        className="gv-su-add"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="gv-su-add__block">
          <span className="ts-label" id="gv-add-type">
            {t("Type of light")}
          </span>
          <div className="gv-su-types" role="radiogroup" aria-labelledby="gv-add-type">
            {FIXTURE_TYPES.map((ft) => (
              <button key={ft.id} type="button" role="radio" aria-checked={ft.id === typeId} className="gv-su-type" onClick={() => setTypeId(ft.id)}>
                <FixtureSymbol kind={ft.symbol} state="normal" rotate={180} size={26} />
                <span className="gv-su-type__text">
                  <span className="gv-su-type__name ts-ellipsis">{t(ft.name)}</span>
                  <span className="gv-su-type__ch">{ft.channels.length === 1 ? t("1 channel") : t("{n} channels", { n: ft.channels.length })}</span>
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="gv-su-add__grid">
          <div className="gv-su-add__block">
            <span className="ts-label">{t("How many")}</span>
            <div className="gv-su-step">
              <Button variant="ghost" iconOnly icon="minus" aria-label={t("One less")} disabled={count <= 1} onClick={() => setCount(Math.max(1, count - 1))} />
              <FieldNumber value={count} min={1} max={24} integer label={t("Number of lights")} onCommit={setCount} />
              <Button variant="ghost" iconOnly icon="plus" aria-label={t("One more")} disabled={count >= 24} onClick={() => setCount(Math.min(24, count + 1))} />
            </div>
          </div>
          <label className="gv-su-add__block">
            <span className="ts-label">{t("Name")}</span>
            <input className="ts-input" value={base} aria-label={t("Name")} placeholder={t("e.g. PAR")} onChange={(e) => setTyped(e.currentTarget.value)} />
            <span className="ts-field__hint">{count > 1 ? t("They will be called {a}, {b}…", { a: names[0] || "—", b: names[1] || "—" }) : t("A number is added: {a}", { a: names[0] || "—" })}</span>
          </label>
        </div>

        <label className="gv-su-add__block">
          <span className="ts-label">{t("Where")}</span>
          <select className="ts-select" value={placeKey} onChange={(e) => setPlaceKey(e.currentTarget.value)} aria-label={t("Where")}>
            <option value="house">{t("In the house")}</option>
            {doc.trusses.length > 0
              ? listGroups(doc)
                  .filter((g) => g.key.kind === "truss")
                  .map((g) => {
                    const id = (g.key as { trussId: string }).trussId;
                    return (
                      <option key={id} value={`truss:${id}`}>
                        {trussName(t, doc, id)}
                      </option>
                    );
                  })
              : null}
            <option value="newTruss">{t("A new truss")}</option>
            <option value="floor">{t("On the floor")}</option>
            <option value="floating">{t("Floating over the stage")}</option>
          </select>
        </label>

        <div className="gv-su-add__block">
          <span className="ts-label">{t("DMX address")}</span>
          <div className="gv-su-add__addr">
            <Segmented<StartKind>
              ariaLabel={t("DMX address")}
              value={startKind}
              onChange={setStartKind}
              options={[
                { value: "next", label: t("First free address") },
                { value: "at", label: t("A number") },
                { value: "none", label: t("None, I will set it later") },
              ]}
            />
            {startKind === "at" ? <FieldNumber value={startAt} min={1} max={512} integer pad label={t("First address")} onCommit={setStartAt} /> : null}
          </div>
          {startKind === "at" && preview.unaddressed ? (
            <span className="gv-su-add__warn">{preview.unaddressed === 1 ? t("1 light does not fit before channel 512 and will have no address.") : t("{n} lights do not fit before channel 512 and will have no address.", { n: preview.unaddressed })}</span>
          ) : startKind === "next" && preview.unaddressed ? (
            <span className="gv-su-add__warn">{t("There is no free room left for all of them: some will have no address.")}</span>
          ) : null}
          <span className="ts-field__hint">{t("The DMX address is the number you set on the keypad behind the light.")}</span>
        </div>
      </form>
    </Dialog>
  );
}
