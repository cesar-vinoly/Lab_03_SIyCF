#include "velocidad.h"
#include "configuracion.h"

static float limitar(float valor, float minimo, float maximo)
{
    return fminf(maximo, fmaxf(valor, minimo));
}

// En equilibrio F(r, u) = r. Buscar u en el intervalo ensayado en Hz.
// La consigna de 80 RPM queda entre las salidas de los dos extremos.
static float frecuencia_base(float rpm)
{
    float inferior = STEP_MIN_HZ;
    float superior = STEP_MAX_HZ;
    if (ts1_economico_predecir(rpm, inferior, inferior) >= rpm) return inferior;
    if (ts1_economico_predecir(rpm, superior, superior) <= rpm) return superior;
    for (int i = 0; i < 18; ++i) {
        float medio = (inferior + superior) * 0.5f;
        if (ts1_economico_predecir(rpm, medio, medio) < rpm) inferior = medio;
        else superior = medio;
    }
    return (superior + inferior) * 0.5f;
}

void velocidad_iniciar(velocidad_t *v)
{
    *v = (velocidad_t){ .base_hz = frecuencia_base(CONSIGNA_MOTOR_RPM) };
    v->objetivo_hz = v->base_hz;
    ts1_economico_iniciar(&v->modelo, 0, 0);
}

void velocidad_actualizar(velocidad_t *v, float rpm_medidas, bool encoder_valido)
{
    if (!encoder_valido || !isfinite(rpm_medidas) || rpm_medidas <= 0.0f ||
        rpm_medidas > ENCODER_MAX_MOTOR_RPM) {
        // Conservar el objetivo evita saltos al alternar base/PI por perdida de pulsos.
        v->filtro_iniciado = false;
        return;
    }
    if (!v->filtro_iniciado) {
        v->rpm_filtradas = rpm_medidas;
        v->filtro_iniciado = true;
    } else {
        v->rpm_filtradas += ENCODER_FILTRO_ALPHA * (rpm_medidas - v->rpm_filtradas);
    }

    // Primero alcanzar la base TS. El error del arranque no debe cargar el PI.
    if (!v->base_alcanzada) return;
    float error = CONSIGNA_MOTOR_RPM - v->rpm_filtradas;
    if (fabsf(error) <= CONTROL_BANDA_RPM) error = 0.0f;
    else error += error > 0.0f ? -CONTROL_BANDA_RPM : CONTROL_BANDA_RPM;

    const float correccion_max = v->base_hz * CONTROL_CORRECCION_MAX;
    const float minimo = fmaxf(STEP_MIN_HZ, v->base_hz - correccion_max);
    const float maximo = fminf(STEP_MAX_HZ, v->base_hz + correccion_max);
    float objetivo = v->base_hz + v->integral_hz + CONTROL_KP_HZ_RPM * error;
    const float incremento = CONTROL_KI_HZ_RPM_S * error * TS1_ECONOMICO_TS;
    // Anti-windup: no acumular hacia la saturacion ni mientras la rampa se retrasa.
    if (((incremento > 0.0f && objetivo < maximo) ||
         (incremento < 0.0f && objetivo > minimo)) &&
        fabsf(v->objetivo_hz - v->aplicada_hz) <= RAMPA_HZ_S * TS1_ECONOMICO_TS) {
        float nueva = limitar(v->integral_hz + incremento, -correccion_max, correccion_max);
        objetivo += nueva - v->integral_hz;
        v->integral_hz = nueva;
    }
    v->objetivo_hz = limitar(objetivo, minimo, maximo);
}

unsigned velocidad_rampa(velocidad_t *v, float dt_s)
{
    if (v->rampa_hz == 0.0f) {
        v->rampa_hz = STEP_MIN_HZ;
    } else {
        // Un retraso de la tarea no debe convertirse en un salto grande de STEP.
        const float delta = RAMPA_HZ_S * limitar(dt_s, 0.0f, ACTUADORES_PERIODO_MS / 1000.0f);
        v->rampa_hz += limitar(v->objetivo_hz - v->rampa_hz, -delta, delta);
    }
    if (fabsf(v->rampa_hz - v->base_hz) < 0.5f) v->base_alcanzada = true;
    return (unsigned)lroundf(limitar(v->rampa_hz, STEP_MIN_HZ, STEP_MAX_HZ));
}

void velocidad_aplicada(velocidad_t *v, float hz)
{
    v->aplicada_hz = hz;
    // El TS se evalua en main a 100 ms, no en cada paso de la rampa de 20 ms.
}

unsigned velocidad_directa(velocidad_t *v, unsigned porcentaje, float dt_s)
{
    // Mismo mando fisico del Lab 1: 100%=150 RPM, 200 pasos y 1/8.
    if (porcentaje > 100) porcentaje = 100;
    const float pasos_rpm = MOTOR_PASOS_VUELTA * MOTOR_MICROPASOS / 60.0f;
    v->objetivo_hz = DIRECTO_MAX_RPM * porcentaje / 100.0f * pasos_rpm;
    if (!porcentaje) { v->rampa_hz = 0; return 0; }
    const float tasa = (v->objetivo_hz > v->rampa_hz ? DIRECTO_ACEL_RPM_S : DIRECTO_FRENO_RPM_S) * pasos_rpm;
    const float delta = tasa * limitar(dt_s, 0.0f, ACTUADORES_PERIODO_MS / 1000.0f);
    v->rampa_hz += limitar(v->objetivo_hz - v->rampa_hz, -delta, delta);
    return (unsigned)lroundf(limitar(v->rampa_hz, STEP_MIN_HZ, STEP_MAX_HZ));
}
