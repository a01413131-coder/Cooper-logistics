# Cooper Logistics

Demo web para Cooper/T. Smith de México.

Incluye:
- Landing page
- Agendamiento de citas
- QR funcional
- Panel administrativo
- Estados automáticos:
  - Confirmada
  - En proceso
  - Completada
- Sincronización entre dispositivos usando Vercel API + GitHub

Credenciales admin:
- Usuario: admin
- Contraseña: admin123

Funcionamiento:
1. Se crea una cita y queda Confirmada.
2. Primer escaneo QR cambia a En proceso.
3. Segundo escaneo QR cambia a Completada.
4. El dashboard consulta la API cada 2 segundos y actualiza el estatus automáticamente.