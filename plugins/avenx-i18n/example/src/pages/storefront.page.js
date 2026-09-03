import basket from '../global/basket.bridge.js';
import LanguageSwitcher from '../components/language-switcher/language-switcher.component.js';

<div>
    <@css card />
    <state customer="Ada" />

    <header @css header>
        <h1 @css title>{{ t('app.title') }}</h1>
        <p @css tagline>{{ t('app.tagline') }}</p>
    </header>

    <LanguageSwitcher />

    <section @css panel>
        <p @css greeting>{{ t('order.greeting', { name: customer }) }}</p>

        <!--
          One message, three plural forms. Which one a count selects is decided
          by Intl.PluralRules for the active locale — nothing in this template
          or in the plugin knows any language's rules.
        -->
        <p @css line>{{ t('order.items', { count: basket.items }) }}</p>

        <p @css line>{{ t('order.total') }}: <strong>{{ n(basket.total, 'currency') }}</strong></p>
        <p @css line>{{ t('order.placed', { when: rel(basket.placedDaysAgo, 'day') }) }}</p>
        <p @css muted>{{ d(basket.placedAt, 'full') }}</p>

        <div @css row>
            <button @css button @click="basket.add()">{{ t('order.add') }}</button>
            <button @css button @click="basket.remove()">{{ t('order.remove') }}</button>
        </div>

        <!--
          The one place on this page where a translation may contain markup.
          tHtml() sanitizes the message and escapes any interpolated value, so
          a translator can write a link and still cannot write a script. It
          returns SafeHtml, which is why ordinary `{{ }}` inserts it as markup;
          every other message on this page is a plain string and is escaped
          like any other expression.
        -->
        <p @css terms>{{ tHtml('order.terms') }}</p>
    </section>

    <footer @css footer>
        <span @css muted>{{ t('nav.settings') }} · {{ locale.current }}</span>
        <!-- A key nothing defines, left in on purpose: it renders as the key
             and logs one warning rather than blanking the line. -->
        <span @css muted>{{ t('order.deliveryEstimate') }}</span>
    </footer>
</div>
