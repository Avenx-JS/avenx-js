<div @css card data-testid="card">
  <h2 @css label data-testid="card-label">{{ props.label }}</h2>
  <p data-testid="card-value">{{ props.value }}</p>

  <div data-testid="card-body">
    <slot>No body provided</slot>
  </div>

  <footer data-testid="card-footer">
    <slot name="footer">No footer provided</slot>
  </footer>
</div>
