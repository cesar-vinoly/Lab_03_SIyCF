#pragma once
// Generado por entrenar.py. No editar las features por separado.
#define TINY_FEATURE_VERSION 2
#define TINY_N_FEATURES 400
#define TINY_CLASS_VERSION 2
#define TINY_N_CLASSES 3
#define TINY_UMBRAL_VOTO 0.600000024f
#define TINY_N_ARBOLES 16
#pragma once
#include <cstdarg>
namespace Eloquent {
    namespace ML {
        namespace Port {
            class ArbolCalidad0 {
                public:
                    /**
                    * Predict class for features vector
                    */
                    int predict(float *x) {
                        if (x[287] <= 0.04651937447488308) {
                            if (x[79] <= 0.04141724854707718) {
                                return 1;
                            }

                            else {
                                return 0;
                            }
                        }

                        else {
                            if (x[395] <= 0.04381824843585491) {
                                return 1;
                            }

                            else {
                                if (x[347] <= 0.04832012392580509) {
                                    if (x[35] <= 0.04206037148833275) {
                                        return 1;
                                    }

                                    else {
                                        return 2;
                                    }
                                }

                                else {
                                    return 2;
                                }
                            }
                        }
                    }

                protected:
                };
            }
        }
    }
#pragma once
#include <cstdarg>
namespace Eloquent {
    namespace ML {
        namespace Port {
            class ArbolCalidad1 {
                public:
                    /**
                    * Predict class for features vector
                    */
                    int predict(float *x) {
                        if (x[114] <= 0.5) {
                            return 2;
                        }

                        else {
                            if (x[11] <= 0.04428987391293049) {
                                if (x[248] <= 0.5) {
                                    if (x[187] <= 0.025253375060856342) {
                                        return 2;
                                    }

                                    else {
                                        return 1;
                                    }
                                }

                                else {
                                    return 1;
                                }
                            }

                            else {
                                if (x[39] <= 0.04531887359917164) {
                                    return 0;
                                }

                                else {
                                    return 2;
                                }
                            }
                        }
                    }

                protected:
                };
            }
        }
    }
#pragma once
#include <cstdarg>
namespace Eloquent {
    namespace ML {
        namespace Port {
            class ArbolCalidad2 {
                public:
                    /**
                    * Predict class for features vector
                    */
                    int predict(float *x) {
                        if (x[59] <= 0.043946875259280205) {
                            if (x[319] <= 0.04446137323975563) {
                                if (x[211] <= 0.11722024157643318) {
                                    return 1;
                                }

                                else {
                                    return 1;
                                }
                            }

                            else {
                                if (x[363] <= 0.0829202476888895) {
                                    if (x[47] <= 0.04244624823331833) {
                                        return 2;
                                    }

                                    else {
                                        return 1;
                                    }
                                }

                                else {
                                    return 1;
                                }
                            }
                        }

                        else {
                            if (x[67] <= 0.04531887359917164) {
                                return 0;
                            }

                            else {
                                return 2;
                            }
                        }
                    }

                protected:
                };
            }
        }
    }
#pragma once
#include <cstdarg>
namespace Eloquent {
    namespace ML {
        namespace Port {
            class ArbolCalidad3 {
                public:
                    /**
                    * Predict class for features vector
                    */
                    int predict(float *x) {
                        if (x[135] <= 0.0687286239117384) {
                            if (x[243] <= 0.04428987391293049) {
                                if (x[19] <= 0.04038824886083603) {
                                    return 1;
                                }

                                else {
                                    if (x[251] <= 0.04017387330532074) {
                                        return 2;
                                    }

                                    else {
                                        return 1;
                                    }
                                }
                            }

                            else {
                                if (x[139] <= 0.04154587537050247) {
                                    return 1;
                                }

                                else {
                                    return 0;
                                }
                            }
                        }

                        else {
                            if (x[372] <= 0.5) {
                                if (x[251] <= 0.03708687610924244) {
                                    return 2;
                                }

                                else {
                                    return 2;
                                }
                            }

                            else {
                                return 1;
                            }
                        }
                    }

                protected:
                };
            }
        }
    }
#pragma once
#include <cstdarg>
namespace Eloquent {
    namespace ML {
        namespace Port {
            class ArbolCalidad4 {
                public:
                    /**
                    * Predict class for features vector
                    */
                    int predict(float *x) {
                        if (x[35] <= 0.04206037148833275) {
                            if (x[239] <= 0.034514375030994415) {
                                return 2;
                            }

                            else {
                                if (x[171] <= 0.5979347229003906) {
                                    return 1;
                                }

                                else {
                                    return 1;
                                }
                            }
                        }

                        else {
                            if (x[291] <= 0.04514737240970135) {
                                if (x[375] <= 0.044547125697135925) {
                                    return 2;
                                }

                                else {
                                    return 0;
                                }
                            }

                            else {
                                return 2;
                            }
                        }
                    }

                protected:
                };
            }
        }
    }
#pragma once
#include <cstdarg>
namespace Eloquent {
    namespace ML {
        namespace Port {
            class ArbolCalidad5 {
                public:
                    /**
                    * Predict class for features vector
                    */
                    int predict(float *x) {
                        if (x[59] <= 0.040688375011086464) {
                            if (x[179] <= 0.035972125828266144) {
                                return 1;
                            }

                            else {
                                return 1;
                            }
                        }

                        else {
                            if (x[311] <= 0.04626212455332279) {
                                if (x[347] <= 0.041888875886797905) {
                                    return 1;
                                }

                                else {
                                    return 0;
                                }
                            }

                            else {
                                if (x[67] <= 0.04767699912190437) {
                                    return 2;
                                }

                                else {
                                    return 1;
                                }
                            }
                        }
                    }

                protected:
                };
            }
        }
    }
#pragma once
#include <cstdarg>
namespace Eloquent {
    namespace ML {
        namespace Port {
            class ArbolCalidad6 {
                public:
                    /**
                    * Predict class for features vector
                    */
                    int predict(float *x) {
                        if (x[335] <= 0.04922049678862095) {
                            if (x[247] <= 0.04223187454044819) {
                                return 1;
                            }

                            else {
                                if (x[311] <= 0.03725837450474501) {
                                    return 2;
                                }

                                else {
                                    if (x[3] <= 0.04450424946844578) {
                                        return 0;
                                    }

                                    else {
                                        return 0;
                                    }
                                }
                            }
                        }

                        else {
                            if (x[379] <= 0.04411837458610535) {
                                return 1;
                            }

                            else {
                                return 2;
                            }
                        }
                    }

                protected:
                };
            }
        }
    }
#pragma once
#include <cstdarg>
namespace Eloquent {
    namespace ML {
        namespace Port {
            class ArbolCalidad7 {
                public:
                    /**
                    * Predict class for features vector
                    */
                    int predict(float *x) {
                        if (x[15] <= 0.0399166252464056) {
                            return 1;
                        }

                        else {
                            if (x[279] <= 0.06071099825203419) {
                                if (x[187] <= 0.044547125697135925) {
                                    return 0;
                                }

                                else {
                                    if (x[139] <= 0.04424699954688549) {
                                        return 0;
                                    }

                                    else {
                                        return 0;
                                    }
                                }
                            }

                            else {
                                if (x[335] <= 0.04596199654042721) {
                                    return 1;
                                }

                                else {
                                    return 2;
                                }
                            }
                        }
                    }

                protected:
                };
            }
        }
    }
#pragma once
#include <cstdarg>
namespace Eloquent {
    namespace ML {
        namespace Port {
            class ArbolCalidad8 {
                public:
                    /**
                    * Predict class for features vector
                    */
                    int predict(float *x) {
                        if (x[163] <= 0.07018637098371983) {
                            if (x[79] <= 0.04360387288033962) {
                                if (x[7] <= 0.040688373148441315) {
                                    return 1;
                                }

                                else {
                                    return 2;
                                }
                            }

                            else {
                                if (x[279] <= 0.04514737240970135) {
                                    return 0;
                                }

                                else {
                                    return 0;
                                }
                            }
                        }

                        else {
                            if (x[63] <= 0.039659375324845314) {
                                if (x[187] <= 0.37344124913215637) {
                                    return 2;
                                }

                                else {
                                    return 1;
                                }
                            }

                            else {
                                return 2;
                            }
                        }
                    }

                protected:
                };
            }
        }
    }
#pragma once
#include <cstdarg>
namespace Eloquent {
    namespace ML {
        namespace Port {
            class ArbolCalidad9 {
                public:
                    /**
                    * Predict class for features vector
                    */
                    int predict(float *x) {
                        if (x[235] <= 0.045361749827861786) {
                            if (x[395] <= 0.04347524791955948) {
                                return 1;
                            }

                            else {
                                if (x[315] <= 0.04531887359917164) {
                                    return 0;
                                }

                                else {
                                    if (x[135] <= 0.04489012435078621) {
                                        return 1;
                                    }

                                    else {
                                        return 2;
                                    }
                                }
                            }
                        }

                        else {
                            if (x[247] <= 0.058524373918771744) {
                                return 2;
                            }

                            else {
                                return 2;
                            }
                        }
                    }

                protected:
                };
            }
        }
    }
#pragma once
#include <cstdarg>
namespace Eloquent {
    namespace ML {
        namespace Port {
            class ArbolCalidad10 {
                public:
                    /**
                    * Predict class for features vector
                    */
                    int predict(float *x) {
                        if (x[267] <= 0.07473112642765045) {
                            if (x[83] <= 0.04368962347507477) {
                                if (x[3] <= 0.041288625448942184) {
                                    return 1;
                                }

                                else {
                                    return 1;
                                }
                            }

                            else {
                                return 0;
                            }
                        }

                        else {
                            if (x[63] <= 0.03948787599802017) {
                                if (x[208] <= 0.5) {
                                    return 1;
                                }

                                else {
                                    return 1;
                                }
                            }

                            else {
                                if (x[391] <= 0.04939199984073639) {
                                    return 1;
                                }

                                else {
                                    return 2;
                                }
                            }
                        }
                    }

                protected:
                };
            }
        }
    }
#pragma once
#include <cstdarg>
namespace Eloquent {
    namespace ML {
        namespace Port {
            class ArbolCalidad11 {
                public:
                    /**
                    * Predict class for features vector
                    */
                    int predict(float *x) {
                        if (x[35] <= 0.0440754983574152) {
                            if (x[372] <= 0.5) {
                                if (x[239] <= 0.057666873559355736) {
                                    if (x[223] <= 0.0625546220690012) {
                                        return 1;
                                    }

                                    else {
                                        return 1;
                                    }
                                }

                                else {
                                    return 2;
                                }
                            }

                            else {
                                return 1;
                            }
                        }

                        else {
                            if (x[7] <= 0.045190246775746346) {
                                if (x[355] <= 0.044161247089505196) {
                                    return 0;
                                }

                                else {
                                    return 0;
                                }
                            }

                            else {
                                return 2;
                            }
                        }
                    }

                protected:
                };
            }
        }
    }
#pragma once
#include <cstdarg>
namespace Eloquent {
    namespace ML {
        namespace Port {
            class ArbolCalidad12 {
                public:
                    /**
                    * Predict class for features vector
                    */
                    int predict(float *x) {
                        if (x[263] <= 0.05144999921321869) {
                            if (x[27] <= 0.043346622958779335) {
                                return 1;
                            }

                            else {
                                return 0;
                            }
                        }

                        else {
                            if (x[383] <= 0.04176024906337261) {
                                return 1;
                            }

                            else {
                                if (x[224] <= 0.5) {
                                    return 2;
                                }

                                else {
                                    return 1;
                                }
                            }
                        }
                    }

                protected:
                };
            }
        }
    }
#pragma once
#include <cstdarg>
namespace Eloquent {
    namespace ML {
        namespace Port {
            class ArbolCalidad13 {
                public:
                    /**
                    * Predict class for features vector
                    */
                    int predict(float *x) {
                        if (x[15] <= 0.044375622645020485) {
                            if (x[15] <= 0.039659375324845314) {
                                return 1;
                            }

                            else {
                                if (x[175] <= 0.39642225950956345) {
                                    if (x[223] <= 0.6033369898796082) {
                                        return 2;
                                    }

                                    else {
                                        return 1;
                                    }
                                }

                                else {
                                    return 1;
                                }
                            }
                        }

                        else {
                            if (x[127] <= 0.07022924907505512) {
                                return 0;
                            }

                            else {
                                return 2;
                            }
                        }
                    }

                protected:
                };
            }
        }
    }
#pragma once
#include <cstdarg>
namespace Eloquent {
    namespace ML {
        namespace Port {
            class ArbolCalidad14 {
                public:
                    /**
                    * Predict class for features vector
                    */
                    int predict(float *x) {
                        if (x[239] <= 0.045790497213602066) {
                            if (x[59] <= 0.043946875259280205) {
                                if (x[347] <= 0.055994752794504166) {
                                    return 1;
                                }

                                else {
                                    if (x[59] <= 0.042489124462008476) {
                                        return 2;
                                    }

                                    else {
                                        return 1;
                                    }
                                }
                            }

                            else {
                                return 0;
                            }
                        }

                        else {
                            return 2;
                        }
                    }

                protected:
                };
            }
        }
    }
#pragma once
#include <cstdarg>
namespace Eloquent {
    namespace ML {
        namespace Port {
            class ArbolCalidad15 {
                public:
                    /**
                    * Predict class for features vector
                    */
                    int predict(float *x) {
                        if (x[19] <= 0.04008812457323074) {
                            return 1;
                        }

                        else {
                            if (x[179] <= 0.04729112237691879) {
                                if (x[179] <= 0.042317625135183334) {
                                    return 1;
                                }

                                else {
                                    return 0;
                                }
                            }

                            else {
                                return 2;
                            }
                        }
                    }

                protected:
                };
            }
        }
    }
class ModeloCalidad {
public:
int predict(float *x, float *acuerdo) {
unsigned votos[TINY_N_CLASSES] = {0};
Eloquent::ML::Port::ArbolCalidad0 a0; ++votos[a0.predict(x)];
Eloquent::ML::Port::ArbolCalidad1 a1; ++votos[a1.predict(x)];
Eloquent::ML::Port::ArbolCalidad2 a2; ++votos[a2.predict(x)];
Eloquent::ML::Port::ArbolCalidad3 a3; ++votos[a3.predict(x)];
Eloquent::ML::Port::ArbolCalidad4 a4; ++votos[a4.predict(x)];
Eloquent::ML::Port::ArbolCalidad5 a5; ++votos[a5.predict(x)];
Eloquent::ML::Port::ArbolCalidad6 a6; ++votos[a6.predict(x)];
Eloquent::ML::Port::ArbolCalidad7 a7; ++votos[a7.predict(x)];
Eloquent::ML::Port::ArbolCalidad8 a8; ++votos[a8.predict(x)];
Eloquent::ML::Port::ArbolCalidad9 a9; ++votos[a9.predict(x)];
Eloquent::ML::Port::ArbolCalidad10 a10; ++votos[a10.predict(x)];
Eloquent::ML::Port::ArbolCalidad11 a11; ++votos[a11.predict(x)];
Eloquent::ML::Port::ArbolCalidad12 a12; ++votos[a12.predict(x)];
Eloquent::ML::Port::ArbolCalidad13 a13; ++votos[a13.predict(x)];
Eloquent::ML::Port::ArbolCalidad14 a14; ++votos[a14.predict(x)];
Eloquent::ML::Port::ArbolCalidad15 a15; ++votos[a15.predict(x)];
int mejor = 0;
for (int i=1; i<TINY_N_CLASSES; ++i) if (votos[i] > votos[mejor]) mejor=i;
*acuerdo = (float)votos[mejor] / TINY_N_ARBOLES;
return mejor;
}
};
