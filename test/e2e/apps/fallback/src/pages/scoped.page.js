<main>
  <h1 data-testid="scoped-heading">Scoped slots</h1>
  <Scoped>
    <template data-slot-props="row">
      <p data-testid="slot-label">{{ row.label }}</p>
      <p data-testid="slot-comparison">{{ row.count > 1 && row.count < 3 }}</p>
      <p data-testid="slot-entity">{{ row.label === '&lt;' ? 'match' : '&lt;' }}</p>
      <p data-testid="slot-literal">&lt;em&gt;literal&lt;/em&gt;</p>
    </template>
  </Scoped>
  <div data-testid="empty-slot"><Scoped /></div>
</main>
