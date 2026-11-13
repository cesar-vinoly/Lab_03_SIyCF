#include "clasificacion.h"
#include "configuracion.h"
#include <math.h>

void ciclo_iniciar(ciclo_t *c)
{
    *c = (ciclo_t){ .estado = ESPERA, .ultimo_metal_ms = -1, .inicio_empuje_ms = -1,
                   .ultimo_eco_ms = -1, .ultimo_eco_cm = NAN };
}

static void entrar_rearme(ciclo_t *c)
{
    c->estado = REARME;
    c->metal = false;
    c->cerca = 0;
    c->libre = 0;
    c->ultimo_metal_ms = -1;
    c->recuperando_eco = false;
    // Conservar desviar_servo e inicio_empuje_ms para terminar un empuje en curso.
}

void ciclo_actualizar(ciclo_t *c, int64_t ahora_ms, float distancia_cm,
                      bool flanco_metal, bool inductivo_bajo, bool centro_listo)
{
    const bool cerca = isfinite(distancia_cm) && distancia_cm >= 2.0f &&
                       distancia_cm <= DISTANCIA_ENTRADA_CM;
    // Una pieza ya detectada puede alejarse mas de 40 cm antes de caer.
    // El umbral de entrada no limita su seguimiento durante el recorrido.
    const bool en_zona = isfinite(distancia_cm) && distancia_cm >= 2.0f &&
                         (DISTANCIA_SEGUIMIENTO_MAX_CM <= 0.0f ||
                          distancia_cm < DISTANCIA_SEGUIMIENTO_MAX_CM);
    // En rearme, recuperar tambien una pieza que reaparece lejos de la entrada.
    // La entrada de un ciclo desde ESPERA conserva el umbral de 12 cm.
    const bool presencia = c->estado == REARME ? en_zona : cerca;

    if (!presencia) c->cerca = 0;
    else if (c->cerca < MUESTRAS_PRESENCIA) ++c->cerca;
    // El ultrasonido decide la ocupacion; el inductivo solo clasifica el material.
    const bool ausencia = !en_zona;
    const int limite_ausencia = c->estado == REARME ? MUESTRAS_REARME :
                               c->estado == TRANSPORTANDO ? MUESTRAS_FIN_TRANSPORTE :
                               MUESTRAS_AUSENCIA;
    if (!ausencia) c->libre = 0;
    else if (c->libre < limite_ausencia) ++c->libre;

    if (c->estado == ESPERA || c->estado == CLASIFICANDO || c->estado == REARME) {
        if (flanco_metal || inductivo_bajo) c->ultimo_metal_ms = ahora_ms;
    }

    switch (c->estado) {
    case REARME:
        if (c->desviar_servo && ahora_ms - c->inicio_empuje_ms < SERVO_PREPARACION_MS) {
            // La cinta ya esta parada, pero la pala debe completar su barrido.
            // No iniciar otro ciclo ni mandar el retorno a mitad del empuje.
            c->cerca = 0;
            c->libre = 0;
            break;
        }
        c->desviar_servo = false;
        if (!centro_listo) {
            // El eco puede ser de la propia pala mientras vuelve. No reclasificar
            // ni acumular presencia/ausencia hasta terminar retorno y asentamiento.
            c->cerca = 0;
            c->libre = 0;
            break;
        }
        if (c->cerca < MUESTRAS_PRESENCIA) {
            if (c->libre >= MUESTRAS_REARME) ciclo_iniciar(c);
            break;
        }
        // La pieza pudo seguir sobre la cinta tras una perdida de eco.
        // No exigir que se retire manualmente: clasificar de nuevo y centrar
        // el servo antes de arrancar. Nunca pasar directo a TRANSPORTANDO.
        /* fall through */
    case ESPERA:
        if (c->cerca < MUESTRAS_PRESENCIA) break;
        c->estado = CLASIFICANDO;
        c->inicio_ms = ahora_ms;
        c->desviar_servo = false;
        c->inicio_empuje_ms = -1;
        c->muestras_salida = 0;
        c->recuperando_eco = false;
        c->parada_por_perdida = false;
        // Aceptar un flanco inmediatamente anterior a la confirmación ultrasónica.
        c->metal = c->ultimo_metal_ms >= 0 &&
                   ahora_ms - c->ultimo_metal_ms <= MEMORIA_METAL_MS;
        // Con la opción inmediata, los dos sensores pueden arrancar en esta muestra.
        /* fall through */
    case CLASIFICANDO:
        c->metal |= flanco_metal || inductivo_bajo;
        if (c->libre >= MUESTRAS_AUSENCIA) {
            ciclo_iniciar(c);
        } else if (en_zona && ((METAL_INMEDIATO && c->metal) ||
                               ahora_ms - c->inicio_ms >= ESPERA_CLASIFICACION_MS)) {
            c->estado = POSICIONANDO;
            c->inicio_ms = ahora_ms;
            c->libre = 0;
        }
        break;
    case POSICIONANDO:
        // Asegurar el centro y el asentamiento antes de arrancar la cinta.
        // El desvio metalico se ordena despues, al llegar al punto de empuje.
        if (!centro_listo) {
            c->libre = 0;
            break;
        }
        // Exigir presencia actual una vez terminada la preparacion. El metal
        // memorizado no sustituye el eco y un NAN nunca habilita el arranque.
        if (c->libre >= MUESTRAS_AUSENCIA) {
            entrar_rearme(c);
        } else if (en_zona) {
            c->estado = TRANSPORTANDO;
            c->inicio_ms = ahora_ms;
            c->libre = 0;
            c->ultimo_eco_ms = ahora_ms;
            c->ultimo_eco_cm = distancia_cm;
        }
        break;
    case TRANSPORTANDO:
        if (c->desviar_servo && ahora_ms - c->inicio_empuje_ms >= SERVO_PREPARACION_MS) {
            // Retirar la pala por tiempo de barrido, INDEPENDIENTEMENTE del eco.
            // Esperar ausencia para retornarla crea un bucle si ella tapa el haz.
            c->desviar_servo = false;
            c->libre = 0;
        }
        if (c->inicio_empuje_ms >= 0 && !c->desviar_servo && !centro_listo) {
            c->libre = 0;
            break; // Mantener transporte, pero verificar salida con la pala centrada.
        }
        if (en_zona) {
            c->ultimo_eco_ms = ahora_ms;
            c->ultimo_eco_cm = distancia_cm;
            c->recuperando_eco = false;
            if (!c->metal && distancia_cm >= DISTANCIA_SALIDA_NO_METAL_CM) {
                if (c->muestras_salida < MUESTRAS_ZONA_SALIDA) ++c->muestras_salida;
            } else c->muestras_salida = 0;
        } else if (c->muestras_salida < MUESTRAS_ZONA_SALIDA) {
            // Confirmar zona de salida exige lecturas consecutivas, no aisladas.
            c->muestras_salida = 0;
        }
        // Mientras haya ecos en zona, transportar sin limite fijo de 10 segundos.
        // Antes de la salida, una caja no metalica puede perder el haz. Dar un
        // margen acotado para recuperarlo, sin tratar el fondo como presencia.
        if (c->libre >= MUESTRAS_FIN_TRANSPORTE) {
            if (!c->metal && c->muestras_salida < MUESTRAS_ZONA_SALIDA &&
                ahora_ms - c->ultimo_eco_ms < RECUPERACION_ECO_NO_METAL_MS) {
                c->recuperando_eco = true;
            } else {
                c->parada_por_perdida = !c->metal && c->muestras_salida < MUESTRAS_ZONA_SALIDA;
                entrar_rearme(c);
            }
        } else if (c->metal && c->inicio_empuje_ms < 0 && en_zona &&
                   distancia_cm >= DISTANCIA_EMPUJE_METAL_CM) {
            // Comparar >=, no igualdad: puede pasar de 31,8 a 32,4 cm entre muestras.
            // Un solo empuje por ciclo, incluso si queda eco al retirar la pala.
            c->desviar_servo = true;
            c->inicio_empuje_ms = ahora_ms;
        }
        break;
    }
}
