import Vue from 'vue'

import * as types from '../../../store/mutation-types';
import cartActions from '../../../store/actions';
import config from 'config';
import rootStore from '@vue-storefront/core/store';
import { sha3_224 } from 'js-sha3';
import { TaskQueue } from '../../../../../lib/sync';
import * as coreHelper from '@vue-storefront/core/helpers';
import { currentStoreView } from '@vue-storefront/core/lib/multistore';
import { onlineHelper } from '@vue-storefront/core/helpers';

jest.mock('@vue-storefront/core/store', () => ({
  dispatch: jest.fn(),
  state: {}
}));
jest.mock('config', () => ({}));
jest.mock('@vue-storefront/i18n', () => ({ t: jest.fn(str => str) }));
jest.mock('js-sha3', () => ({ sha3_224: jest.fn() }));
jest.mock('@vue-storefront/core/lib/multistore', () => ({
  currentStoreView: jest.fn(),
  localizedRoute: jest.fn()
}));
jest.mock('@vue-storefront/core/lib/logger', () => ({
  Logger: {
    log: jest.fn(() => () => {}),
    debug: jest.fn(() => () => {}),
    warn: jest.fn(() => () => {}),
    error: jest.fn(() => () => {})
  }
}));
jest.mock('@vue-storefront/core/lib/sync', () => ({ TaskQueue: {
  execute: jest.fn()
}}));
jest.mock('@vue-storefront/core/app', () => ({ router: jest.fn() }));
jest.mock('@vue-storefront/core/lib/search/searchQuery', () => jest.fn());
jest.mock('@vue-storefront/core/helpers', () => ({
  get isServer () {
    return true
  },
  onlineHelper: {
    get isOnline () {
      return true
    }
  }
}));

Vue.prototype.$bus = {
  $emit: jest.fn()
};

describe('Cart actions', () => {
  const isServerSpy = jest.spyOn((coreHelper as any).default, 'isServer', 'get');

  beforeEach(() => {
    (TaskQueue.execute as jest.Mock).mockReset();
    (rootStore as any).state = {};
    Object.keys(config).forEach((key) => { delete config[key]; });
  });

  it('#disconnect - clears cart token', async () => {
    const contextMock = {
      commit: jest.fn()
    };
    const wrapper = (actions: any) => actions.disconnect(contextMock);

    await wrapper(cartActions);

    expect(contextMock.commit).toBeCalledWith(types.CART_LOAD_CART_SERVER_TOKEN, null);
    expect(contextMock.commit).toBeCalledTimes(1);
  });

  describe('#clear', () => {
    let contextMock;
    let wrapper;

    beforeEach(() => {
      contextMock = {
        getters: {
          isCartSyncEnabled: () => true,
        },
        commit: jest.fn(),
        dispatch: jest.fn(),
      };
      config['orders'] = { directBackendSync: true };
      wrapper = (actions: any) => actions.clear(contextMock);
    })

    it('deletes all cart products and token',  async () => {
      await wrapper(cartActions);

      expect(contextMock.commit).toBeCalledWith(types.CART_LOAD_CART, []);
      expect(contextMock.commit).toBeCalledWith(types.CART_LOAD_CART_SERVER_TOKEN, null);
      expect(contextMock.commit).toBeCalledWith(types.CART_SET_ITEMS_HASH, null);
    });

    it('dispatches creating a new cart on server with direct backend sync when its configured', async () => {
      await wrapper(cartActions);

      expect(contextMock.dispatch).toBeCalledWith('connect', {guestCart: false});
    });

    it('dispatches creating a new cart on server with queuing when direct backend sync is not configured', async () => {
      config['orders'] = { directBackendSync: false };

      await wrapper(cartActions);

      expect(contextMock.dispatch).toBeCalledWith('connect', {guestCart: true});
    });
  })

  describe('sync', () => {
    it('doesn\'t update shipping methods if cart is empty', async () => {
      const contextMock = {
        rootGetters: { checkout: { isUserInCheckout: () => false } },
        getters: { isCartSyncEnabled: () => true, isTotalsSyncRequired: () => true, isSyncRequired: () => true, isCartConnected: () => true },
        dispatch: jest.fn(),
        state: {
          cartItems: [],
          cartServerToken: 'some-token',
          cartItemsHash: 'some-sha-hash'
        }
      };

      config.cart = { synchronize: true };
      (rootStore as any).state = {
        checkout: {
          shippingDetails: {
            country: 'pl'
          }
        }
      };

      const expectedState = {
        cartItems: [],
        cartItemsHash: 'new-hash',
        cartServerPullAt: 1000003000
      };

      isServerSpy.mockReturnValueOnce(false);
      Date.now = jest.fn(() => expectedState.cartServerPullAt);
      (sha3_224 as any).mockReturnValueOnce(expectedState.cartItemsHash);
      // (TaskQueue.execute as jest.Mock).mockImplementationOnce(() => Promise.resolve({}));

      const wrapper = (actions: any) => actions.serverPull(contextMock, {});

      await wrapper(cartActions);
      expect(contextMock.dispatch).not.toBeCalledWith(
        'cart/syncShippingMethods',
        { country_id: 'us' }
      );
    });

    it('does not do anything if synchronization is off', async () => {
      const contextMock = {
        rootGetters: { checkout: { isUserInCheckout: () => false } },
        getters: { isCartSyncEnabled: () => true, isTotalsSyncRequired: () => true, isSyncRequired: () => true, isCartConnected: () => true },
        dispatch: jest.fn()
      };

      config.cart = { synchronize: false };

      const wrapper = (actions: any) => actions.serverPull(contextMock, {});

      await wrapper(cartActions);

      expect(TaskQueue.execute).not.toBeCalled();
    });

    it('does not do anything in SSR environment', async () => {
      const contextMock = {
        rootGetters: { checkout: { isUserInCheckout: () => false } },
        getters: { isCartSyncEnabled: () => true, isTotalsSyncRequired: () => true, isSyncRequired: () => true, isCartConnected: () => true },
        dispatch: jest.fn()
      };

      config.cart = { synchronize: true };

      const wrapper = (actions: any) => actions.serverPull(contextMock, {});

      await wrapper(cartActions);

      expect(TaskQueue.execute).not.toBeCalled();
    });
  });

  describe('syncTotals', () => {
    it('does not do anything if totals synchronization is off', () => {
      const contextMock = {
        rootGetters: { checkout: { isUserInCheckout: () => false } },
        getters: { isCartSyncEnabled: () => false, isTotalsSyncEnabled: () => false, isTotalsSyncRequired: () => true, isSyncRequired: () => true, isCartConnected: () => true },
        state: {
          cartServerToken: 'some-token'
        }
      };

      config.cart = { synchronize_totals: false };

      const wrapper = (actions: any) => actions.syncTotals(contextMock);

      wrapper(cartActions);

      expect(TaskQueue.execute).not.toBeCalled();
    });

    it('does not do anything in SSR environment', () => {
      const contextMock = {};

      config.cart = { synchronize_totals: true };

      const wrapper = (actions: any) => actions.syncTotals(contextMock);

      wrapper(cartActions);

      expect(TaskQueue.execute).not.toBeCalled();
    });
  });

  describe('connect', () => {
    it('requests to backend for creation of a new cart', async () => {
      const contextMock = {
        state: {
          cartconnectdAt: 1000000000
        },
        getters: { isCartSyncEnabled: () => true, isTotalsSyncRequired: () => true, isSyncRequired: () => true, isCartConnected: () => true }
      };

      config.cart = { synchronize: true };

      isServerSpy.mockReturnValueOnce(false);
      Date.now = jest.fn(() => 1000003000);
      (TaskQueue.execute as jest.Mock).mockImplementationOnce(() => Promise.resolve({}));

      const wrapper = (actions: any) => actions.connect(contextMock, {});

      await wrapper(cartActions);

      expect(TaskQueue.execute).toBeCalled();
    });

    it('requests to backend for creation of guest cart', async () => {
      const contextMock = {
        rootGetters: { checkout: { isUserInCheckout: () => false } },
        getters: { isCartSyncEnabled: () => true, isTotalsSyncRequired: () => true, isSyncRequired: () => true, isCartConnected: () => true },
        state: {
          cartconnectdAt: 1000000000
        }
      };

      config.cart = {
        synchronize: true,
        create_endpoint: 'http://example.url/guest-cart/{{token}}'
      };

      isServerSpy.mockReturnValueOnce(false);
      Date.now = jest.fn(() => 1000003000);
      (TaskQueue.execute as jest.Mock).mockImplementationOnce(() => Promise.resolve({}));

      const wrapper = (actions: any) => actions.connect(contextMock, { guestCart: true });

      await wrapper(cartActions);
      expect(TaskQueue.execute).toBeCalledWith(expect.objectContaining({ url: 'http://example.url/guest-cart/' }))
    });

    it('does not do anything if last totals sync was done recently', () => {
      const contextMock = {
        state: {
          cartconnectdAt: 1000000000
        }
      };

      config.cart = { synchronize: true };

      isServerSpy.mockReturnValueOnce(false);
      Date.now = jest.fn(() => 1000000050);

      const wrapper = (actions: any) => actions.connect(contextMock, {});

      wrapper(cartActions);

      expect(TaskQueue.execute).not.toBeCalled();
    });

    it('does not do anything if totals synchronization is off', () => {
      const contextMock = {};

      config.cart = { synchronize: false };

      const wrapper = (actions: any) => actions.connect(contextMock, {});

      wrapper(cartActions);

      expect(TaskQueue.execute).not.toBeCalled();
    });

    it('does not do anything in SSR environment', () => {
      const contextMock = {};

      config.cart = { synchronize: true };

      const wrapper = (actions: any) => actions.connect(contextMock, {});

      wrapper(cartActions);

      expect(TaskQueue.execute).not.toBeCalled();
    });
  });

  describe('#applyCoupon', () => {
    let contextMock;
    const couponCode = 'qwerty';
    const wrapper = (actions: any) => actions.applyCoupon(contextMock, couponCode)

    beforeEach(() => {
      contextMock = {
        getters: {
          isTotalsSyncEnabled: () => true,
          isCartConnected: () => true
        },
        dispatch: jest.fn(),
      };
      config['cart'] = {
        applycoupon_endpoint: 'http://example.url/'
      };
    });

    it('dispatches #syncTotals if POST for apply coupon returns true', async () => {
      (TaskQueue.execute as jest.Mock).mockImplementationOnce(() => Promise.resolve({ result: true }));

      await wrapper(cartActions)

      expect(contextMock.dispatch).toBeCalledWith('syncTotals', { forceServerSync: true })
    })

    it('does not dispatch #syncTotals if  POST for apply coupon returns false', async () => {
      (TaskQueue.execute as jest.Mock).mockImplementationOnce(() => Promise.resolve({ result: false }));

      await wrapper(cartActions)

      expect(contextMock.dispatch).not.toBeCalled()
    })

    it('does not dispatch #syncTotals if POST for apply coupon throws an error', async () => {
      (TaskQueue.execute as jest.Mock).mockImplementationOnce(() => Promise.resolve(new Error('Async error')));

      await wrapper(cartActions)

      expect(contextMock.dispatch).not.toBeCalled()
    })
  })
});
