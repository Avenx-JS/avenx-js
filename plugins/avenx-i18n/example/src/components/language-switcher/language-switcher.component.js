<div>
    <@css switcher />

    <span @css label>{{ t('nav.language') }}</span>

    <!--
      `locale.available` lists every locale that has messages or a loader, so
      French and Italian appear here before they have been downloaded. Choosing
      one fetches it and then switches; `locale.loading` is reactive, so the
      hint below appears on its own while that happens, with no extra wiring.
    -->
    <@for tag in locale.available key="tag">
        <button
            @css choice
            type="button"
            data-locale="{{ tag }}"
            @click="locale.set(event.target.dataset.locale)"
        >{{ tag }}</button>
    </@for>

    <span @css loading data-ax-show="locale.loading">…</span>
</div>
