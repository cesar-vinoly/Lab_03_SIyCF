"""Calculos operativos con parametros medidos, sin valores inventados del montaje."""
import math


def positivo(x):
    if not math.isfinite(x) or x<=0: raise ValueError('Se requiere valor positivo medido')


def velocidad_banda(rpm_motor, radio_rodillo_m, dientes_motor=19, dientes_rodillo=40):
    positivo(radio_rodillo_m); positivo(dientes_motor); positivo(dientes_rodillo)
    if not math.isfinite(rpm_motor) or rpm_motor<0: raise ValueError('RPM invalidas')
    return rpm_motor*dientes_motor/dientes_rodillo*(2*math.pi*radio_rodillo_m)/60


def sincronizacion(distancia_m, velocidad_m_s, servo_s, margen_s):
    for x in (distancia_m,velocidad_m_s,servo_s): positivo(x)
    if not math.isfinite(margen_s) or margen_s<0: raise ValueError('Margen invalido')
    vuelo=distancia_m/velocidad_m_s
    espera=vuelo-servo_s-margen_s
    return {'vuelo_s':vuelo,'comandar_despues_s':max(0,espera),'viable':espera>0,
            'velocidad_limite_m_s':distancia_m/(servo_s+margen_s)}


def oee(total, buenos, planificado_s, operativo_s, ciclo_ideal_s):
    positivo(planificado_s); positivo(operativo_s); positivo(ciclo_ideal_s)
    if type(total) is not int or type(buenos) is not int or not 0<=buenos<=total or operativo_s>planificado_s:
        raise ValueError('Conteos o tiempos incoherentes')
    a=operativo_s/planificado_s
    p=total*ciclo_ideal_s/operativo_s
    q=buenos/total if total else None
    return {'disponibilidad':a,'rendimiento':p,'calidad':q,'oee':a*p*q if q is not None else None,
            'revisar_ciclo_ideal':p>1} # No esconder inconsistencias recortando a 100%.


def perdida_anual(objetos_h, fraccion_reproceso, costo_objeto, horas_dia, dias_anio):
    for x in (objetos_h,costo_objeto,horas_dia,dias_anio):
        if not math.isfinite(x) or x<0: raise ValueError('Costo/produccion invalido')
    if not math.isfinite(fraccion_reproceso) or not 0<=fraccion_reproceso<=1: raise ValueError('Fraccion invalida')
    return objetos_h*fraccion_reproceso*costo_objeto*horas_dia*dias_anio
