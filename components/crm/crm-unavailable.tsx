/** Estado exibido quando as tabelas do CRM ainda não existem no banco. */
export function CrmUnavailable() {
  return (
    <section className="section" aria-labelledby="crm-unavailable-title">
      <div className="notice warning" role="status">
        <strong id="crm-unavailable-title">CRM indisponível no momento.</strong> Se esta é a primeira vez, aplique as migrações{" "}
        <code>sql/neon_crm.sql</code>, <code>sql/neon_crm_prospects.sql</code> e <code>sql/neon_crm_gestao.sql</code> no Neon. Suas buscas, listas e leads continuam funcionando normalmente.
      </div>
    </section>
  );
}
