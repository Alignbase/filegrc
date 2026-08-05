export function assessRequiredAppointments(records, model) {
  const templates = model.appointmentTemplates || {};
  return Object.entries(templates).map(([kind, template]) => {
    const appointments = records.filter((record) => (
      record.type === "appointment"
      && record.appointmentKind === kind
      && record.status !== "ended"
    ));
    const active = appointments.find(({ status }) => status === "active");
    const planned = appointments.find(({ status }) => status === "planned");
    return {
      kind,
      template,
      requiredness: template.requiredness,
      record: active || planned || null,
      state: active ? "complete" : "ready"
    };
  });
}
