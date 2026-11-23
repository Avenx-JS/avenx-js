import { AvenxRouter } from './AvenxRouter.js';
import { installRouter } from './routerCapability.js';

// The compiler links this side effect when the application needs routing.
installRouter({ AvenxRouter });
